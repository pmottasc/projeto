/**
 * Parsers modulares por banco
 *
 * Estratégia universal:
 * - Trabalhamos sobre o texto completo do PDF (todas as páginas concatenadas).
 * - Identificamos transações por padrões regex robustos que capturam:
 *     DATA  ...  VALOR  TIPO(C/D ou +/-)
 * - Linhas seguintes sem data/valor são tratadas como continuação da descrição.
 * - Filtramos linhas de "Saldo Anterior", "SALDO DO DIA", cabeçalhos, totais.
 *
 * Funciona para a maioria dos extratos brasileiros (BB, Bradesco, Itaú,
 * Caixa, Santander, Sicoob, Sicredi, Inter, Nubank, C6, etc).
 */
import type { ExtractedTransaction } from './pdf-parser';

// ---------- Contexto opcional para datas sem ano ----------

export interface ParserContext {
  /** Ano padrão para datas que vêm sem ano (ex: Sicoob "DD/MM"). */
  referenceYear?: number;
  /** Mês padrão (1-12) - usado se a data não trouxer mês também (raro). */
  referenceMonth?: number;
  /** Quando true, inclui a seção "Lançamentos Futuros". Padrão: false. */
  includeFuture?: boolean;
}

// ---------- Utilitários ----------

const BR_MONEY = String.raw`[-+−]?\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}`;
const BR_MONEY_RE = new RegExp(BR_MONEY, 'g');

/** Normaliza valor monetário brasileiro: "1.234,56" → 1234.56 */
export function normalizeAmount(raw: string): number {
  let cleaned = raw.replace(/[R$\s*]/g, '').replace('−', '-').trim();
  const negative = cleaned.startsWith('-');
  cleaned = cleaned.replace(/^[\-+]/, '');
  cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return negative ? -num : num;
}

/** Normaliza data para YYYYMMDD. Aceita DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY ou DD/MM (com ano de fallback). */
export function normalizeDate(raw: string, fallbackYear?: number): string {
  // Com ano completo
  const fullMatch = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, '0');
    const month = fullMatch[2].padStart(2, '0');
    let year = fullMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}${month}${day}`;
  }
  // Sem ano (DD/MM) — usa fallbackYear
  const shortMatch = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if (shortMatch && fallbackYear) {
    const day = shortMatch[1].padStart(2, '0');
    const month = shortMatch[2].padStart(2, '0');
    return `${fallbackYear}${month}${day}`;
  }
  return '';
}

/** Linhas que devem ser ignoradas (cabeçalhos, saldos, rodapés) */
const SKIP_LINE_PATTERNS = [
  /saldo\s+anterior/i,
  /saldo\s+do\s+dia/i,
  /saldo\s+bloqueado/i,
  /^saldo\s+(em|atual|final|disponível|disponivel)/i,
  /^s\.?a\.?l\.?d\.?o/i,
  /^dt\.?\s*(balancete|movimento)/i,
  /^data\s+(hist|lan|descri|documento)/i,
  /^per[ií]odo/i,
  /^cliente/i,
  /^cooperativa/i,
  /^conta\s*:/i,
  /^lan[cç]amentos\s*$/i,
  /^p[aá]gina\s+\d/i,
  /^ag[eê]ncia\s+\d/i,
  /^conta\s+(corrente|poupan)/i,
  /^extrato\s+(de|da|conta)/i,
  /^total\s+(de|do|geral)/i,
  /^expansao/i,
  /^empresa\s*$/i,
  /^banco\s+do\s+brasil/i,
  /^sicoob\s*\|/i,
  /^hist[óo]rico\s+de\s+movimenta/i,
  /sicoobnet/i,
  /^G\d{10,}/,
];

function shouldSkip(line: string): boolean {
  if (!line.trim()) return true;
  return SKIP_LINE_PATTERNS.some(p => p.test(line));
}

// ---------- Extração de documento da descrição ----------

function splitDescriptionAndDocument(raw: string): { description: string; document: string } {
  let cleaned = raw.trim();

  cleaned = cleaned.replace(/^\d{4}\s+\d{4,6}\s+\d{2,4}\s+/, '').trim();
  cleaned = cleaned.replace(/^\d{4}\s+\d{4,10}\s+/, '').trim();
  cleaned = cleaned.replace(/^0000\s+/, '').trim();

  if (!cleaned) return { description: raw.trim(), document: '' };

  const docMatch = cleaned.match(/\s+([\d]{1,5}(?:\.\d{1,3}){1,5})\s*$/);
  if (docMatch) {
    const desc = cleaned.substring(0, cleaned.lastIndexOf(docMatch[1])).trim();
    return { description: desc || cleaned, document: docMatch[1] };
  }

  const simpleDocMatch = cleaned.match(/\s+(\d{4,})\s*$/);
  if (simpleDocMatch) {
    const desc = cleaned.substring(0, cleaned.lastIndexOf(simpleDocMatch[1])).trim();
    return { description: desc || cleaned, document: simpleDocMatch[1] };
  }

  return { description: cleaned, document: '' };
}

// ---------- Parser Universal (formato BR com C/D) ----------

/**
 * Parser para extratos brasileiros que usam a notação "valor C/D".
 *
 * Aceita os seguintes formatos por linha:
 *   DD/MM/YYYY ... 1.234,56 C [opcional: 99.999,99 C]
 *   DD/MM/YYYY ... R$ 1.234,56C        (Sicoob: C/D colado, R$ na frente)
 *   DD/MM      ... R$ 1.234,56C        (Sicoob: data sem ano)
 *
 * Linhas sem data no início são consideradas continuação da descrição
 * da última transação.
 */
function parseWithCDNotation(text: string, ctx?: ParserContext): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Regex flexível:
  //   ^(DATA)              → grupo 1: data com ou sem ano
  //   \s+(.+?)             → grupo 2: middle (descrição/documento)
  //   \s+R?\$?\s*          → opcional "R$"
  //   (\d{1,3}(?:\.\d{3})*,\d{2})   → grupo 3: valor
  //   \s*([CD])            → grupo 4: tipo (com ou sem espaço)
  //   (?:\s+R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*[CD])?  → saldo opcional
  //   \s*\*?\s*$
  const txnRegex =
    /^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])(?:\s+R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*[CD])?\s*\*?\s*$/;

  const startsWithDate = /^(\d{2}\/\d{2}(?:\/\d{4})?)\b/;

  let lastIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (shouldSkip(line)) continue;

    const match = line.match(txnRegex);

    if (match) {
      const [, dateStr, middle, amountStr, typeChar] = match;
      const normDate = normalizeDate(dateStr, ctx?.referenceYear);
      if (!normDate) continue;

      const amount = normalizeAmount(amountStr);
      if (amount <= 0) continue;

      // Pular se o "middle" indica uma linha de saldo
      if (/saldo\s+(anterior|do\s+dia|em|atual|bloqueado)/i.test(middle)) continue;

      const { description, document } = splitDescriptionAndDocument(middle);

      transactions.push({
        date: normDate,
        description: description || middle.trim(),
        document,
        amount,
        type: typeChar === 'C' ? 'CREDIT' : 'DEBIT',
      });
      lastIdx = transactions.length - 1;
      continue;
    }

    if (startsWithDate.test(line)) continue;

    // Linha que termina com valor C/D mas sem data = lixo, ignorar
    if (/\d{1,3}(?:\.\d{3})*,\d{2}\s*[CD]\s*\*?\s*$/.test(line)) continue;

    // Continuação da descrição
    if (lastIdx >= 0 && line.length < 200) {
      const prev = transactions[lastIdx];
      if (!prev.description.includes(line)) {
        transactions[lastIdx] = {
          ...prev,
          description: `${prev.description} ${line}`.replace(/\s+/g, ' ').trim(),
        };
      }
    }
  }

  return transactions;
}

// ---------- Parser Universal (formato com sinal +/- ou colunas separadas) ----------

function parseWithSignedAmount(text: string, ctx?: ParserContext): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const hasValorSaldoLayout = /valor\s*(?:\(\s*r\$\s*\))?[\s\S]{0,120}saldo\s*(?:\(\s*r\$\s*\))?/i.test(text);

  // CRÍTICO: Layouts com colunas "Valor" + "Saldo" (ex.: Sicredi).
  // Quando a linha termina com DOIS valores monetários, o penúltimo é
  // o VALOR da movimentação e o último é o SALDO após o lançamento.
  // O sinal pode estar em qualquer um dos dois (saldo pode ser negativo).
  const patternValSaldoFull = new RegExp(
    `^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(.+?)\\s+(${BR_MONEY})\\s+(${BR_MONEY})\\s*$`,
  );
  const patternValSaldoShort = new RegExp(
    `^(\\d{2}\\/\\d{2})\\s+(.+?)\\s+(${BR_MONEY})\\s+(${BR_MONEY})\\s*$`,
  );

  const pattern1 = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(.+?)\\s+(${BR_MONEY})\\s*$`);
  const pattern2 = new RegExp(`^(\\d{2}\\/\\d{2})\\s+(.+?)\\s+(${BR_MONEY})\\s*$`);

  let lastIdx = -1;
  const fallbackYear = ctx?.referenceYear ?? new Date().getFullYear();

  for (const line of lines) {
    if (shouldSkip(line)) continue;

    // 1) Tenta primeiro o padrão Valor+Saldo (dois valores no fim)
    const mvs = line.match(patternValSaldoFull) || line.match(patternValSaldoShort);
    if (mvs) {
      const [, dateStr, middle, valorStr, saldoStr] = mvs;
      const hasYear = /\d{4}/.test(dateStr);
      const normDate = hasYear ? normalizeDate(dateStr) : normalizeDate(dateStr, fallbackYear);
      if (!normDate) continue;
      if (/saldo\s+(anterior|do\s+dia|em|atual|bloqueado|final|disponi)/i.test(middle)) continue;

      const valorClean = valorStr.replace(/\s/g, '');
      const saldoClean = saldoStr.replace(/\s/g, '');
      const valor = normalizeAmount(valorClean);
      const saldo = normalizeAmount(saldoClean);
      if (valor === 0) continue;

      const { description, document } = splitDescriptionAndDocument(middle);
      const isDebit = valor < 0 || valorClean.startsWith('-');

      transactions.push({
        date: normDate,
        description: description || middle.trim(),
        document,
        amount: Math.abs(valor),
        type: isDebit ? 'DEBIT' : 'CREDIT',
        balance: saldo,
      });
      lastIdx = transactions.length - 1;
      continue;
    }

    // 2) Fallback: linha com um único valor no fim
    const match = line.match(pattern1) || line.match(pattern2);
    const hasYear = !!line.match(pattern1);

    if (match) {
      if (hasValorSaldoLayout) {
        // Em layouts tabulares com colunas Valor + Saldo, uma linha datada com
        // apenas um valor monetário é ambígua e costuma ser só o SALDO extraído
        // sem a coluna Valor. Não importamos para impedir saldo como lançamento.
        const monetaryTokens = line.match(BR_MONEY_RE) || [];
        if (monetaryTokens.length < 2) continue;
      }

      const [, dateStr, middle, amountStr] = match;
      const normDate = hasYear
        ? normalizeDate(dateStr)
        : normalizeDate(dateStr, fallbackYear);
      if (!normDate) continue;

      if (/saldo\s+(anterior|do\s+dia|em|atual|bloqueado|final|disponi)/i.test(middle)) continue;

      const cleanedAmount = amountStr.replace(/\s/g, '');
      const amount = normalizeAmount(cleanedAmount);
      if (amount === 0) continue;

      const { description, document } = splitDescriptionAndDocument(middle);
      const isDebit = amount < 0 || cleanedAmount.startsWith('-');

      transactions.push({
        date: normDate,
        description: description || middle.trim(),
        document,
        amount: Math.abs(amount),
        type: isDebit ? 'DEBIT' : 'CREDIT',
      });
      lastIdx = transactions.length - 1;
      continue;
    }

    if (lastIdx >= 0 && line.length < 200 && !/^\d{2}\/\d{2}/.test(line)) {
      const prev = transactions[lastIdx];
      if (!prev.description.includes(line)) {
        transactions[lastIdx] = {
          ...prev,
          description: `${prev.description} ${line}`.replace(/\s+/g, ' ').trim(),
        };
      }
    }
  }

  return transactions;
}

// ---------- Parser específico Sicoob ----------

/**
 * Sicoob — extratos web do SicoobNet vêm com layout tabular muito particular:
 * cada célula da tabela vira uma linha separada no texto extraído.
 *
 * Estrutura típica (por transação):
 *   DD/MM
 *   <documento ou "Pix" ou vazio>
 *   HISTÓRICO ...
 *   (linhas adicionais de detalhe)
 *   R$ 1.234,56C   (ou D)
 *
 * Estratégia: varremos linha a linha, abrindo um "registro" quando encontramos
 * uma linha que é APENAS uma data DD/MM, e fechamos quando encontramos uma
 * linha de valor "R$ ... C/D". Tudo no meio é descrição.
 */
function parseSicoob(text: string, ctx?: ParserContext): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split('\n').map(l => l.trim());
  const fallbackYear = ctx?.referenceYear ?? new Date().getFullYear();

  // Regex auxiliares
  const dateOnlyShort = /^(\d{2}\/\d{2})$/;
  const dateOnlyFull = /^(\d{2}\/\d{2}\/\d{4})$/;
  const amountRegex = /^R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])\s*\*?\s*$/;

  // Caso 1: tudo na mesma linha (texto colado) — fallback CD
  // Mas vamos primeiro tentar o modo "tabela quebrada"

  type Pending = { date: string; parts: string[] };
  let pending: Pending | null = null;

  const flushAsTransaction = (p: Pending, amountStr: string, typeChar: 'C' | 'D') => {
    const normDate = normalizeDate(p.date, fallbackYear);
    if (!normDate) return;

    const amount = normalizeAmount(amountStr);
    if (amount <= 0) return;

    // Junta tudo, separa documento (primeiro pedaço se for numérico/Pix) e descrição
    const parts = p.parts.map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    let document = '';
    let descParts = parts;

    // Primeira parte como documento se for: "Pix", numérico, ou padrão XX.XXX/000.123 etc
    const first = parts[0];
    if (
      /^pix$/i.test(first) ||
      /^\d{1,8}$/.test(first) ||
      /^\d{2,3}\.\d{3,}$/.test(first) ||
      /^\d{6,}$/.test(first)
    ) {
      document = first;
      descParts = parts.slice(1);
    }

    const description = descParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!description) return;

    // Pular saldos
    if (/saldo\s+(anterior|do\s+dia|em|atual|bloqueado)/i.test(description)) return;

    transactions.push({
      date: normDate,
      description,
      document,
      amount,
      type: typeChar === 'C' ? 'CREDIT' : 'DEBIT',
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Pula cabeçalhos do Sicoob
    if (
      /^data$|^documento$|^hist[óo]rico$|^valor$/i.test(line) ||
      /sicoobnet|internet\s+banking|extrato\s+de\s+conta|cooperativa\s*:|conta\s*:|periodo\s*:|per[ií]odo\s*:/i.test(line) ||
      /^https?:\/\//i.test(line) ||
      /^\d+\/\d+\s*$/.test(line) && !dateOnlyShort.test(line) && !dateOnlyFull.test(line) // "1/15", "2/15"
    ) {
      // Ainda assim, "1/15" pode bater com dateOnlyShort. Filtra por contexto:
      // datas reais têm o segundo número entre 01-12, paginação pode ser >12.
      const m = line.match(dateOnlyShort);
      if (m) {
        const month = parseInt(m[1].split('/')[1], 10);
        if (month >= 1 && month <= 12) {
          // É data válida — não pula
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    // Linha é APENAS uma data?
    const dShort = line.match(dateOnlyShort);
    const dFull = line.match(dateOnlyFull);
    if (dShort || dFull) {
      const dateStr = (dFull ? dFull[1] : dShort![1]);
      // Validar mês
      const monthPart = parseInt(dateStr.split('/')[1], 10);
      if (monthPart < 1 || monthPart > 12) continue;

      // Se já temos pending sem fechar, descartamos
      pending = { date: dateStr, parts: [] };
      continue;
    }

    // Linha é um valor R$ X,XXC/D?
    const aMatch = line.match(amountRegex);
    if (aMatch && pending) {
      flushAsTransaction(pending, aMatch[1], aMatch[2] as 'C' | 'D');
      pending = null;
      continue;
    }

    // Caso contrário: parte da descrição do registro pendente
    if (pending) {
      pending.parts.push(line);
    }
  }

  return transactions;
}

// ---------- Parser específico Cresol ----------

/**
 * Cresol — extrato web (Cooperativa de Crédito Cresol).
 *
 * Layout típico (uma transação por linha após extração via pdf.js):
 *   DD/MM/AAAA DESCRIÇÃO LIVRE - R$ 1.234,56     (débito, sinal "-")
 *   DD/MM/AAAA DESCRIÇÃO LIVRE + R$ 1.234,56     (crédito, sinal "+")
 *
 * Cabeçalhos a ignorar (já cobertos por SKIP_LINE_PATTERNS):
 *   - "Saldo em Conta", "Limite de Crédito", "Saldo Disponível"
 *   - "Saldo do Dia: + R$ ..." (resumo diário, NÃO é lançamento)
 *   - "Saldo Anterior: + R$ ..."
 *
 * IMPORTANTE: o "Saldo do Dia" tem sempre sinal "+" mas é apenas
 * o saldo acumulado — nunca pode ser somado como crédito.
 */
function parseCresol(text: string, _ctx?: ParserContext): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];

  // Estratégia line-based: o extrato Cresol tem SEMPRE a data + valor na MESMA linha,
  // e a descrição pode estar:
  //   (a) na mesma linha (ex.: "10/04/2026 PIX DEBITO PARA: ...   - R$ 3,00")
  //   (b) quebrada nas linhas IMEDIATAMENTE acima e/ou abaixo (linhas indentadas
  //       sem data, sem "Saldo", sem "R$").
  //
  // Linhas a IGNORAR (não viram lançamento):
  //   - "Saldo do Dia" / "Saldo Anterior" / "Saldo em Conta" / "Saldo Disponível"
  //   - cabeçalhos "Lançamentos", "Página X de Y", "Periodo de ...", "Consulta..."
  //
  // Tipo: sinal "+" → CREDIT, sinal "-" → DEBIT.

  const rawLines = text.split(/\r?\n/);

  // Regex de uma "linha de lançamento": contém data DD/MM/AAAA e termina com
  // "± R$ valor" (com ou sem texto entre eles).
  const txLineRe = /(\d{2}\/\d{2}\/\d{4})\s+(.*?)([+\-−])\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

  const isSaldoLine = (s: string) =>
    /saldo\s+(do\s+dia|anterior|em\s+conta|dispon[ií]vel|atual|final|inicial|bloqueado)/i.test(s);

  const isHeaderLine = (s: string) =>
    /^(?:lan[cç]amentos?|p[aá]gina\s+\d|per[ií]odo\s+de|consulta\s+posi|limite\s+de\s+cr|ag[eê]ncia\s+\d|cicles|saldo\s+em\s+conta)/i.test(
      s.trim(),
    ) || /^R\$\s*\d/.test(s.trim());

  const isDescriptionLine = (s: string) => {
    const t = s.trim();
    if (!t) return false;
    if (isSaldoLine(t)) return false;
    if (isHeaderLine(t)) return false;
    if (/\d{2}\/\d{2}\/\d{4}/.test(t)) return false; // tem data → outra transação
    if (/R\$\s*\d/.test(t)) return false; // tem valor → outra transação ou saldo
    return true;
  };

  const seen = new Set<string>();
  // Regex para "± R$ valor" sozinho (linha de valor isolada após descrição quebrada)
  const valueOnlyRe = /^([+\-−])\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  const dateOnlyRe = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s*$/;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isSaldoLine(line)) continue;

    let dateStr: string | undefined;
    let midDesc = '';
    let signChar: string | undefined;
    let amountStr: string | undefined;
    let consumedNext = 0;

    const m = line.match(txLineRe);
    if (m) {
      [, dateStr, midDesc, signChar, amountStr] = m;
    } else {
      // Caso multi-linha: "DD/MM/AAAA DESCRIÇÃO" + (linhas extras de descrição) + "± R$ valor"
      const md = line.match(dateOnlyRe);
      if (!md) continue;
      if (isSaldoLine(line) || isHeaderLine(line)) continue;
      // procura próxima linha de valor (até 4 linhas adiante)
      const extraDesc: string[] = [];
      let foundAt = -1;
      for (let j = i + 1; j < Math.min(rawLines.length, i + 5); j++) {
        const ln = rawLines[j].trim();
        if (!ln) continue;
        const vm = ln.match(valueOnlyRe);
        if (vm) {
          signChar = vm[1];
          amountStr = vm[2];
          foundAt = j;
          break;
        }
        if (isDescriptionLine(ln)) {
          extraDesc.push(ln);
        } else {
          break;
        }
      }
      if (foundAt < 0 || !signChar || !amountStr) continue;
      dateStr = md[1];
      midDesc = [md[2], ...extraDesc].join(' ');
      consumedNext = foundAt - i;
    }

    if (!dateStr || !signChar || !amountStr) continue;

    const amount = normalizeAmount(amountStr);
    if (amount <= 0) continue;

    const normDate = normalizeDate(dateStr);
    if (!normDate) continue;

    // Coleta descrição: linha acima (se for desc), meio, linha abaixo (se não consumimos via multi-linha)
    const descParts: string[] = [];
    if (i > 0 && isDescriptionLine(rawLines[i - 1])) {
      descParts.push(rawLines[i - 1].trim());
    }
    const mid = midDesc.trim();
    if (mid) descParts.push(mid);
    if (consumedNext === 0 && i + 1 < rawLines.length && isDescriptionLine(rawLines[i + 1])) {
      descParts.push(rawLines[i + 1].trim());
    }

    let desc = descParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!desc) desc = 'LANÇAMENTO';
    if (isSaldoLine(desc)) continue;

    const key = `${normDate}|${amount.toFixed(2)}|${desc.slice(0, 30)}|${signChar}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isDebit = signChar === '-' || signChar === '−';
    transactions.push({
      date: normDate,
      description: desc,
      document: '',
      amount,
      type: isDebit ? 'DEBIT' : 'CREDIT',
    });

    if (consumedNext > 0) i += consumedNext;
  }

  return transactions;
}

// ---------- Parser Híbrido Inteligente ----------

export function parseStatementSmart(text: string, ctx?: ParserContext): ExtractedTransaction[] {
  // Por padrão, ignora a seção "Lançamentos Futuros" — não devem misturar
  // com lançamentos realizados do extrato. Quando o usuário quiser importá-los,
  // deve passar ctx.includeFuture (ou usar uma chamada dedicada).
  const cut = text.search(/lan[cç]amentos?\s+futuros?/i);
  const mainText = !ctx?.includeFuture && cut > 0 ? text.slice(0, cut) : text;

  const candidates = [
    { name: 'cd', results: safeRun(parseWithCDNotation, mainText, ctx) },
    { name: 'signed', results: safeRun(parseWithSignedAmount, mainText, ctx) },
    { name: 'sicoob', results: safeRun(parseSicoob, mainText, ctx) },
    { name: 'cresol', results: safeRun(parseCresol, mainText, ctx) },
  ];

  return pickBest(candidates).results;
}

function safeRun(
  fn: (text: string, ctx?: ParserContext) => ExtractedTransaction[],
  text: string,
  ctx?: ParserContext,
): ExtractedTransaction[] {
  try {
    return fn(text, ctx);
  } catch {
    return [];
  }
}

/**
 * Escolhe o "melhor" parser priorizando:
 *  1. Maior número de transações (sinal mais forte de que reconheceu o layout)
 *  2. Em empate, o que tem mistura de DEBIT e CREDIT (parser que classifica
 *     tudo como o mesmo tipo é suspeito de erro de leitura)
 *  3. Em empate, o que tem mais descrições não vazias / mais documentos
 */
function pickBest<T extends { results: ExtractedTransaction[] }>(candidates: T[]): T {
  const score = (r: ExtractedTransaction[]) => {
    if (r.length === 0) return -1;
    const credits = r.filter(t => t.type === 'CREDIT').length;
    const debits = r.filter(t => t.type === 'DEBIT').length;
    const mixed = credits > 0 && debits > 0 ? 1 : 0;
    const withDesc = r.filter(t => t.description && t.description !== 'LANÇAMENTO').length;
    return r.length * 1000 + mixed * 100 + withDesc;
  };
  return [...candidates].sort((a, b) => score(b.results) - score(a.results))[0];
}

// ---------- Mapeamento por banco ----------

const bankParsers: Record<string, (text: string, ctx?: ParserContext) => ExtractedTransaction[]> = {
  bb: parseWithCDNotation,
  sicoob: parseSicoob,
  sicredi: parseStatementSmart,
  caixa: parseStatementSmart,
  bradesco: parseStatementSmart,
  itau: parseStatementSmart,
  santander: parseStatementSmart,
  inter: parseStatementSmart,
  nubank: parseStatementSmart,
  c6: parseStatementSmart,
  cresol: parseCresol,
  outros: parseStatementSmart,
};

/**
 * Seleciona o parser adequado e processa o texto do PDF.
 * Se o parser específico devolver muito pouco, faz fallback ao smart.
 */
export function parseStatementByBank(
  text: string,
  bankId: string,
  ctx?: ParserContext,
): ExtractedTransaction[] {
  const parser = bankParsers[bankId] || parseStatementSmart;
  const specific = safeRun(parser, text, ctx);
  const smart = parseStatementSmart(text, ctx);

  // Sempre compara o parser específico com o "smart" (que já testa todos os
  // formatos conhecidos) e devolve o melhor. Isso garante que extratos de
  // bancos não detectados, ou com layout atípico, ainda sejam lidos.
  return pickBest([
    { name: bankId, results: specific },
    { name: 'smart', results: smart },
  ]).results;
}

/** Compatibilidade. */
export const parseGenericStatement = parseStatementSmart;

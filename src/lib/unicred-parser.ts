/**
 * Parser específico para extratos UNICRED (Instituição Financeira 136).
 *
 * Layout real (confirmado no PDF extraído via pdf.js):
 *   Linha 1 (física): "DD/MM/YYYY  <Nr.Docum>"
 *   Linha 2 (física): "<valor>[  <saldo>] <histórico>"
 *   Linha 3+ (opc.):  continuação do histórico (letra solta, nome, etc.)
 *
 * O parser agrupa em "linhas lógicas" (uma por lançamento) e extrai:
 *   - DATA
 *   - Nr.Docum
 *   - VALOR da transação (sempre o PRIMEIRO valor da linha lógica)
 *   - SALDO do dia (SEGUNDO valor, se existir — descartado, apenas para conciliação)
 *   - Histórico
 *
 * Ignora linhas de cabeçalho/rodapé, "Saldo Anterior", "A Transportar",
 * "De Transporte", "Posição em", "Lançamentos Futuros" etc.
 */
import type { ExtractedTransaction } from './pdf-parser';
import { normalizeAmount, normalizeDate } from './bank-parsers';

const DATE_RE = /^(\d{2}\/\d{2}\/\d{4})\b/;
const DATE_ANYWHERE_RE = /(\d{2}\/\d{2}\/\d{4})/;
const AMOUNT_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;
const AMOUNT_ONLY_RE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;

/** Palavras-chave para classificar como CRÉDITO. */
const CREDIT_KEYWORDS = [
  /\bCREDITO\s+DE\s+COBRANC/i,
  /\bCR[EÉ]D\s+RECEBIMENTO\s+P/i,
  /\bCR[EÉ]D\s+REC\s+DEV\s+PIX/i,
  /^CRED\s+PIX\b/i,
  /\bCRED\s+PIX\b/i,
  /\bCRD\s+DEVPIX\b/i,
  /\bCR[EÉ]DITOS?\s+COBRAN/i,
  /\bDEP\s+DINHEIRO/i,
  /\bDEP\s+TERMINAL/i,
  /\bDEP\s+EM\s+ESP[ÉE]CIE/i,
  /\bRESG\s+APLIC/i,
];

/** Palavras-chave para classificar como DÉBITO. */
const DEBIT_KEYWORDS = [
  /\bLIQ\s+TIT(ULO)?\b/i,
  /\bD[ÉE]B(\.|ITO)?\s+TARIFA/i,
  /\bDEB\.\s*TARIFA/i,
  /\bAPLIC\s+FINANCEIRA/i,
  /\bPGTO\s+PIX\b/i,
  /\bDEBITO\s+PAGAMENTO\s+P/i,
  /\bDEBITO\s+TRANSF\s+PIX/i,
  /^DEB\s+PIX\b/i,
  /\bDEB\s+PIX\b/i,
  /\bSAQUE\s+CAIXA\b/i,
  /\bSAQUE\s+CASH\s+REC/i,
  /\bSAQUE\b/i,
  /\bARREC\s+CONV[EÊ]NIOS?/i,
  /\bARREC\s+CONVENIO/i,
  /\bDEB\s+PORTO\s+SEGURO/i,
  /\bDEB\s+CUSTAS/i,
  /\bCUSTAS\s+CORRESPONDE/i,
  /\bVISA\s+DEB\s+FATURA/i,
  /\bLIQ\s+PARCELA\s+EMPR/i,
  /\bDEBITO\s+DE\s+COBRANCA/i,
  /\bENV\s+TED/i,
  /\bDEB\s+CONSORCIO/i,
  /\bLIQ\s+PARCELA/i,
  /\bTRF\s+ENT\s+CTAS/i,
];

/** Linhas a pular completamente. */
const SKIP_PATTERNS = [
  /^UNICRED/i,
  /^Sistema\s+de\s+Automa/i,
  /^Fone\s+Contato/i,
  /^Institui[çc][aã]o\s+Financeira/i,
  /^EXTRATO\s+DE\s+CONTA/i,
  /^DISTRIBUIDORA/i,
  /^Conta\s*:/i,
  /^Ag[eê]ncia\s*:/i,
  /^Posto\s*:/i,
  /^Per[ií]odo\s+de/i,
  /^Data\s+Nr\.?Docum/i,
  /^Hist[óo]rico\s*$/i,
  /^Saldo\s+Anterior/i,
  /^De\s+Transporte\s*$/i,
  /^A\s+Transportar\s*$/i,
  /^Vers[aã]o/i,
  /^Unicred\s+do\s+Brasil/i,
  /^\s*750824\s+750824\s*$/i,
  /^Juros\s+(Adiant|Cheque)/i,
  /^CPMF\s+Devido/i,
  /^Posi[çc][aã]o\s+em/i,
  /^Saldo\s+Posi[çc][aã]o/i,
  /^Limite\s+de\s+Cr[eé]dito/i,
  /^Saldo\s+Bloqueado/i,
  /^IOF/i,
  /^Taxa\s+M[aá]xima/i,
  /^Informa[çc][õo]es\s+Cheque/i,
  /^CET\s*-/i,
  /^Saldo\s+Dispon[ií]vel/i,
  /^Lan[çc]amentos\s+Futuros/i,
  /^Extrato\s+para\s+simples/i,
  /^Cooperado\s+Unicred/i,
  /^Autom[áa]tico\s+para/i,
  /^SAC\s+Unicred/i,
  /^\*+\s+Lan[çc]amentos/i,
  /^\*\*/i,
  /^\s*:\s*$/,
  /^\s*---PAGE---\s*$/i,
  /^\d+\s+de\s+\d+\s*$/, // "1 de 13"
];

/** Tudo APÓS estas linhas é descartado (lançamentos futuros / info). */
const STOP_PATTERNS = [
  /^Lan[çc]amentos\s+Futuros/i,
  /^Saldo\s+Posi[çc][aã]o/i,
  /^Posi[çc][aã]o\s+em/i,
  /^Extrato\s+para\s+simples/i,
];

type AmountToken = {
  raw: string;
  index: number;
};

function shouldSkip(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return SKIP_PATTERNS.some(p => p.test(t));
}

function isStopLine(line: string): boolean {
  return STOP_PATTERNS.some(p => p.test(line.trim()));
}

/** Classifica uma descrição como CREDIT/DEBIT. Retorna null se ambíguo. */
function classifyByHistory(desc: string): 'CREDIT' | 'DEBIT' | null {
  // Créditos têm prioridade quando ambíguo (ex: "DEP TERMINAL SAQUE/P" contém "SAQUE")
  if (CREDIT_KEYWORDS.some(re => re.test(desc))) return 'CREDIT';
  if (DEBIT_KEYWORDS.some(re => re.test(desc))) return 'DEBIT';
  return null;
}

/** Extrai "Nr.Docum" do início do texto após a data. */
function extractDocument(afterDate: string): { doc: string; rest: string } {
  const trimmed = afterDate.trim();
  const special = [
    /^CRED\s+PIX\b/i,
    /^PGTO\s+PIX\b/i,
    /^DEB\s+PIX\b/i,
    /^CRD\s+DEVPIX\b/i,
    /^Conv[eê]nio\b/i,
    /^SAQUE\b/i,
    /^DepSeP\b/i,
    /^VISA\b/i,
  ];
  for (const re of special) {
    const m = trimmed.match(re);
    if (m) return { doc: m[0], rest: trimmed.slice(m[0].length).trim() };
  }
  const m = trimmed.match(/^(\S+)\s+(.*)$/);
  if (m) return { doc: m[1], rest: m[2] };
  return { doc: '', rest: trimmed };
}

/** Marcador solto: linha com 1-2 caracteres alfanuméricos (continuação de histórico). */
function isLooseMarker(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 2 && /^[A-Za-z0-9]$/.test(t[0]);
}

/** Linha que é APENAS um valor numérico (saldo de transporte isolado). */
function isOnlyAmount(line: string): boolean {
  return AMOUNT_ONLY_RE.test(line.trim());
}

function pickTransactionAndBalance(
  amountTokens: AmountToken[],
  runningBalance: number | null,
): { transaction: AmountToken; balance: AmountToken | null } | null {
  if (amountTokens.length === 0) return null;

  if (amountTokens.length === 1) {
    const only = normalizeAmount(amountTokens[0].raw);
    if (runningBalance != null && Math.abs(only - runningBalance) < 0.005) {
      return null;
    }
    return { transaction: amountTokens[0], balance: null };
  }

  if (runningBalance != null) {
    let best:
      | {
          transaction: AmountToken;
          balance: AmountToken;
          error: number;
          preference: number;
        }
      | null = null;

    for (let i = 0; i < amountTokens.length; i++) {
      const balanceCandidate = amountTokens[i];
      const candidateBalance = normalizeAmount(balanceCandidate.raw);
      const expectedDelta = Math.abs(candidateBalance - runningBalance);

      for (let j = 0; j < amountTokens.length; j++) {
        if (i === j) continue;

        const transactionCandidate = amountTokens[j];
        const candidateAmount = normalizeAmount(transactionCandidate.raw);
        const error = Math.abs(expectedDelta - candidateAmount);
        const preference =
          (i === amountTokens.length - 1 ? 0 : 1) +
          (balanceCandidate.index > transactionCandidate.index ? 0 : 0.25);

        if (error < 0.02) {
          if (!best || error < best.error || (Math.abs(error - best.error) < 0.0001 && preference < best.preference)) {
            best = {
              transaction: transactionCandidate,
              balance: balanceCandidate,
              error,
              preference,
            };
          }
        }
      }
    }

    if (best) {
      return { transaction: best.transaction, balance: best.balance };
    }
  }

  return {
    transaction: amountTokens[0],
    balance: amountTokens[amountTokens.length - 1],
  };
}

function buildDescriptionFromRest(rest: string, amountTokens: AmountToken[], doc: string): string {
  const ordered = [...amountTokens].sort((a, b) => a.index - b.index);
  const parts: string[] = [];
  let cursor = 0;

  for (const token of ordered) {
    if (token.index > cursor) parts.push(rest.slice(cursor, token.index));
    cursor = token.index + token.raw.length;
  }
  if (cursor < rest.length) parts.push(rest.slice(cursor));

  const description = parts.join(' ').replace(/\s+/g, ' ').trim();
  return description || doc;
}

/**
 * Constrói linhas lógicas: uma por lançamento. Cada linha lógica começa numa
 * data. Pula saldos de transporte isolados e para ao encontrar STOP_PATTERNS.
 */
function buildLogicalLines(text: string): { logical: string[]; opening: number | null } {
  const raw = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0);

  const logical: string[] = [];
  let current: string | null = null;
  let opening: number | null = null;
  let sawHeader = false;
  let stopped = false;

  // Padrões que marcam fim/quebra de página: ao encontrá-los, fechamos a
  // transação corrente para que saldos de transporte da próxima página não
  // sejam anexados a ela.
  const BOUNDARY = [
    /^A\s+Transportar\s*$/i,
    /^De\s+Transporte\s*$/i,
    /^Vers[aã]o/i,
    /^Unicred\s+do\s+Brasil/i,
    /^\s*---PAGE---\s*$/i,
    /^\d+\s+de\s+\d+\s*$/,
    /^Sistema\s+de\s+Automa/i,
  ];
  const isBoundary = (l: string) => BOUNDARY.some(p => p.test(l.trim()));

  for (const line of raw) {
    if (stopped) break;
    if (isStopLine(line)) {
      stopped = true;
      break;
    }

    if (isBoundary(line)) {
      // Fecha transação corrente; o próximo valor isolado será tratado como
      // saldo de transporte (ignorado pois current==null).
      if (current) {
        logical.push(current);
        current = null;
      }
      continue;
    }

    if (shouldSkip(line)) continue;

    // Saldo anterior (primeiro valor isolado antes do cabeçalho "Data Nr.Docum")
    if (!sawHeader && isOnlyAmount(line) && opening === null) {
      opening = normalizeAmount(line);
      continue;
    }
    if (/^Data\s+Nr\.?Docum/i.test(line)) {
      sawHeader = true;
      continue;
    }

    // Valor isolado: se estamos construindo uma transação, é parte dela.
    // Se não (após boundary), é saldo de transporte — ignora.
    if (isOnlyAmount(line)) {
      if (current) current += ' ' + line;
      continue;
    }

    const m = line.match(DATE_ANYWHERE_RE);
    if (m) {
      if (current) logical.push(current);
      const idx = line.indexOf(m[1]);
      let normalized = line;
      if (idx > 0) {
        normalized = `${m[1]} ${line.slice(0, idx).trim()} ${line.slice(idx + m[1].length).trim()}`
          .replace(/\s+/g, ' ')
          .trim();
      }
      current = normalized;
    } else if (current) {
      if (isLooseMarker(line)) continue;
      current += ' ' + line;
    }
  }
  if (current) logical.push(current);

  return { logical, opening };
}

/** Parser principal. */
export function parseUnicredText(text: string): ExtractedTransaction[] {
  const { logical, opening } = buildLogicalLines(text);
  const transactions: ExtractedTransaction[] = [];
  let runningBalance: number | null = opening;

  for (const line of logical) {
    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1];
    const afterDate = line.slice(dateStr.length).trim();
    const { doc, rest } = extractDocument(afterDate);

    const amountMatches = [...rest.matchAll(AMOUNT_RE)].map(m => ({
      raw: m[1],
      index: m.index ?? 0,
    }));
    const selection = pickTransactionAndBalance(amountMatches, runningBalance);
    if (!selection) continue;

    const firstAmount = selection.transaction;
    const balanceRaw = selection.balance?.raw ?? null;

    let description = buildDescriptionFromRest(rest, amountMatches, doc);
    if (!description) description = doc;
    if (!description || /^saldo\s+anterior/i.test(description)) continue;

    const amount = normalizeAmount(firstAmount.raw);
    if (!(amount > 0)) continue;

    const normDate = normalizeDate(dateStr);
    if (!normDate) continue;

    let type = classifyByHistory(description);

    // Fallback: comparar saldo com runningBalance para inferir sinal
    if (!type && balanceRaw && runningBalance != null) {
      const newBal = normalizeAmount(balanceRaw);
      const diff = newBal - runningBalance;
      if (Math.abs(Math.abs(diff) - amount) < 0.02) {
        type = diff >= 0 ? 'CREDIT' : 'DEBIT';
      }
    }
    if (!type) type = 'DEBIT';

    transactions.push({
      date: normDate,
      description,
      document: doc || '',
      amount,
      type,
    });

    if (balanceRaw) {
      runningBalance = normalizeAmount(balanceRaw);
    } else if (runningBalance != null) {
      runningBalance += type === 'CREDIT' ? amount : -amount;
    }
  }

  return transactions;
}

/**
 * Wrapper que aceita o File (para compatibilidade), operando sobre o texto já
 * extraído pelo pdf.js. Se nenhum texto for passado, extrai do arquivo.
 */
export async function extractUnicredTransactions(
  file: File,
  preExtractedText?: string,
): Promise<{ transactions: ExtractedTransaction[]; rawText: string }> {
  let text = preExtractedText;
  if (!text) {
    const { extractTextFromPDF } = await import('./pdf-parser');
    const pages = await extractTextFromPDF(file);
    text = pages.join('\n');
  }
  const transactions = parseUnicredText(text);
  return { transactions, rawText: text };
}

/** Heurística para detectar PDF Unicred no texto bruto. */
export function isUnicredText(text: string): boolean {
  const low = text.toLowerCase();
  return (
    low.includes('unicred') ||
    low.includes('sistema de automação unicred') ||
    low.includes('sistema de automacao unicred') ||
    /institui[çc][aã]o\s+financeira\s*:?\s*136/i.test(text)
  );
}

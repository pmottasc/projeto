/**
 * Validador de OFX gerado.
 *
 * Faz uma checagem de sanidade sobre:
 *  - Metadados (banco, conta, tipo)
 *  - Campos obrigatórios por transação (data, valor, tipo, descrição, FITID)
 *  - Formato de data YYYYMMDD e intervalo DTSTART/DTEND
 *  - FITIDs únicos (evita duplicidade no importador contábil)
 *  - Soma dos créditos, débitos e saldo final (LEDGERBAL) em relação às transações
 *  - Presença de cabeçalho OFXHEADER e blocos obrigatórios
 */
import type { ExtractedTransaction } from './pdf-parser';
import type { OFXBankInfo } from './ofx-generator';

export interface OFXValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface OFXValidationResult {
  ok: boolean;
  errors: OFXValidationIssue[];
  warnings: OFXValidationIssue[];
  summary: {
    count: number;
    totalCredits: number;
    totalDebits: number;
    ledgerBalance: number;
    dtStart: string | null;
    dtEnd: string | null;
  };
}

const DATE_RE = /^\d{8}$/;

/** Arredonda para 2 casas, evitando erros de ponto flutuante. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extrai o conteúdo de uma tag OFX SGML (primeira ocorrência). */
function pick(content: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

/** Extrai todos os valores de uma tag repetida. */
function pickAll(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

export function validateOFX(
  ofxContent: string,
  transactions: ExtractedTransaction[],
  bankInfo: OFXBankInfo,
): OFXValidationResult {
  const errors: OFXValidationIssue[] = [];
  const warnings: OFXValidationIssue[] = [];

  // ---------- 1. Metadados de entrada ----------
  if (!bankInfo.bankId || !/^\d{3}$/.test(bankInfo.bankId)) {
    errors.push({ level: 'error', message: 'Código do banco (BANKID) inválido ou ausente (esperado 3 dígitos).' });
  }
  if (!bankInfo.accountId || !/^\d+$/.test(bankInfo.accountId.replace(/[^\d]/g, ''))) {
    errors.push({ level: 'error', message: 'Número da conta (ACCTID) ausente ou não numérico.' });
  }
  if (bankInfo.accountType !== 'CHECKING' && bankInfo.accountType !== 'SAVINGS') {
    errors.push({ level: 'error', message: 'Tipo de conta (ACCTTYPE) deve ser CHECKING ou SAVINGS.' });
  }

  // ---------- 2. Transações ----------
  if (transactions.length === 0) {
    errors.push({ level: 'error', message: 'Nenhuma transação para exportar.' });
  }

  let totalCredits = 0;
  let totalDebits = 0;

  transactions.forEach((t, i) => {
    const pos = `Linha ${i + 1}`;
    if (!t.date || !DATE_RE.test(t.date)) {
      errors.push({ level: 'error', message: `${pos}: data inválida (formato esperado YYYYMMDD).` });
    }
    if (!t.description || !t.description.trim()) {
      errors.push({ level: 'error', message: `${pos}: descrição/histórico em branco.` });
    }
    if (typeof t.amount !== 'number' || !isFinite(t.amount) || t.amount <= 0) {
      errors.push({ level: 'error', message: `${pos}: valor inválido ou zero.` });
    }
    if (t.type !== 'CREDIT' && t.type !== 'DEBIT') {
      errors.push({ level: 'error', message: `${pos}: tipo deve ser CREDIT ou DEBIT.` });
    } else if (t.amount > 0) {
      if (t.type === 'CREDIT') totalCredits += t.amount;
      else totalDebits += t.amount;
    }
  });

  totalCredits = round2(totalCredits);
  totalDebits = round2(totalDebits);
  const expectedLedger = round2(totalCredits - totalDebits);

  // ---------- 3. Conteúdo OFX ----------
  if (!ofxContent || ofxContent.length < 50) {
    errors.push({ level: 'error', message: 'Conteúdo OFX vazio ou muito curto.' });
    return {
      ok: false, errors, warnings,
      summary: {
        count: transactions.length, totalCredits, totalDebits,
        ledgerBalance: expectedLedger, dtStart: null, dtEnd: null,
      },
    };
  }

  if (!ofxContent.startsWith('OFXHEADER:')) {
    errors.push({ level: 'error', message: 'Cabeçalho OFXHEADER ausente.' });
  }
  const requiredBlocks = ['<OFX>', '<SIGNONMSGSRSV1>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<STMTRS>', '<BANKTRANLIST>', '<LEDGERBAL>'];
  for (const block of requiredBlocks) {
    if (!ofxContent.includes(block)) {
      errors.push({ level: 'error', message: `Bloco obrigatório ausente no OFX: ${block}` });
    }
  }

  // ---------- 4. Conferência de tags principais ----------
  const bankId = pick(ofxContent, 'BANKID');
  const acctId = pick(ofxContent, 'ACCTID');
  const acctType = pick(ofxContent, 'ACCTTYPE');
  const curDef = pick(ofxContent, 'CURDEF');
  const dtStart = pick(ofxContent, 'DTSTART')?.slice(0, 8) ?? null;
  const dtEnd = pick(ofxContent, 'DTEND')?.slice(0, 8) ?? null;
  const balAmtRaw = pick(ofxContent, 'BALAMT');

  if (bankId && bankInfo.bankId && bankId !== bankInfo.bankId) {
    warnings.push({ level: 'warning', message: `BANKID do OFX (${bankId}) difere do informado (${bankInfo.bankId}).` });
  }
  if (curDef && curDef !== 'BRL') {
    warnings.push({ level: 'warning', message: `Moeda inesperada: ${curDef} (esperado BRL).` });
  }
  if (acctType && acctType !== bankInfo.accountType) {
    warnings.push({ level: 'warning', message: `ACCTTYPE do OFX (${acctType}) difere do informado (${bankInfo.accountType}).` });
  }
  if (acctId && bankInfo.accountId && acctId.replace(/^0+/, '') !== bankInfo.accountId.replace(/[^\d]/g, '').replace(/^0+/, '')) {
    warnings.push({ level: 'warning', message: `ACCTID do OFX (${acctId}) difere do informado (${bankInfo.accountId}).` });
  }

  // ---------- 5. Intervalo de datas ----------
  if (dtStart && !DATE_RE.test(dtStart)) {
    errors.push({ level: 'error', message: `DTSTART inválido: ${dtStart}` });
  }
  if (dtEnd && !DATE_RE.test(dtEnd)) {
    errors.push({ level: 'error', message: `DTEND inválido: ${dtEnd}` });
  }
  if (dtStart && dtEnd && DATE_RE.test(dtStart) && DATE_RE.test(dtEnd) && dtStart > dtEnd) {
    errors.push({ level: 'error', message: `DTSTART (${dtStart}) é posterior a DTEND (${dtEnd}).` });
  }

  const validDates = transactions.map(t => t.date).filter(d => DATE_RE.test(d));
  if (validDates.length > 0) {
    const minDate = validDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = validDates.reduce((a, b) => (a > b ? a : b));
    if (dtStart && dtStart !== minDate) {
      warnings.push({ level: 'warning', message: `DTSTART (${dtStart}) difere da menor data das transações (${minDate}).` });
    }
    if (dtEnd && dtEnd !== maxDate) {
      warnings.push({ level: 'warning', message: `DTEND (${dtEnd}) difere da maior data das transações (${maxDate}).` });
    }
  }

  // ---------- 6. STMTTRN × transações fornecidas ----------
  const stmttrnBlocks = ofxContent.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  if (stmttrnBlocks.length !== transactions.length) {
    errors.push({
      level: 'error',
      message: `Quantidade de transações no OFX (${stmttrnBlocks.length}) difere da lista revisada (${transactions.length}).`,
    });
  }

  // FITID únicos
  const fitIds = pickAll(ofxContent, 'FITID');
  const fitSet = new Set(fitIds);
  if (fitIds.length !== fitSet.size) {
    errors.push({ level: 'error', message: 'Há FITIDs duplicados no OFX — o importador rejeitará o arquivo.' });
  }
  if (fitIds.length !== stmttrnBlocks.length) {
    errors.push({ level: 'error', message: `Transações sem FITID (${stmttrnBlocks.length - fitIds.length} faltando).` });
  }

  // Soma dos TRNAMT
  const trnAmts = pickAll(ofxContent, 'TRNAMT').map(v => parseFloat(v));
  if (trnAmts.some(v => !isFinite(v))) {
    errors.push({ level: 'error', message: 'Há TRNAMT não numérico no OFX.' });
  } else {
    const sumCredits = round2(trnAmts.filter(v => v > 0).reduce((s, v) => s + v, 0));
    const sumDebits = round2(trnAmts.filter(v => v < 0).reduce((s, v) => s + Math.abs(v), 0));
    if (sumCredits !== totalCredits) {
      errors.push({
        level: 'error',
        message: `Soma de créditos do OFX (R$ ${sumCredits.toFixed(2)}) difere do esperado (R$ ${totalCredits.toFixed(2)}).`,
      });
    }
    if (sumDebits !== totalDebits) {
      errors.push({
        level: 'error',
        message: `Soma de débitos do OFX (R$ ${sumDebits.toFixed(2)}) difere do esperado (R$ ${totalDebits.toFixed(2)}).`,
      });
    }
  }

  // ---------- 7. LEDGERBAL ----------
  let ledgerBalance = 0;
  if (balAmtRaw === null) {
    errors.push({ level: 'error', message: 'LEDGERBAL/BALAMT ausente.' });
  } else {
    const parsed = parseFloat(balAmtRaw);
    if (!isFinite(parsed)) {
      errors.push({ level: 'error', message: `BALAMT não numérico: ${balAmtRaw}` });
    } else {
      ledgerBalance = round2(parsed);
      if (ledgerBalance !== expectedLedger) {
        errors.push({
          level: 'error',
          message: `Saldo final do OFX (R$ ${ledgerBalance.toFixed(2)}) difere da soma créditos − débitos (R$ ${expectedLedger.toFixed(2)}).`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      count: transactions.length,
      totalCredits,
      totalDebits,
      ledgerBalance: balAmtRaw ? ledgerBalance : expectedLedger,
      dtStart,
      dtEnd,
    },
  };
}

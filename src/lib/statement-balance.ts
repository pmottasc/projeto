/**
 * Extrai saldos (anterior/final) e valida conciliação.
 *
 * Conciliação esperada:
 *   saldoInicial + créditos − débitos = saldoFinal
 *
 * Usado para bloquear export OFX quando os números não fecham.
 */
import type { ExtractedTransaction } from './pdf-parser';
import { normalizeAmount } from './bank-parsers';

export interface StatementBalances {
  opening: number | null;
  closing: number | null;
  source: string; // descrição de onde veio (debug)
}

/** Tenta detectar saldo anterior e saldo final no texto bruto. */
export function extractBalances(text: string): StatementBalances {
  // Achata o texto também — alguns PDFs (Cresol) embaralham linhas via pdf.js.
  const flat = text.replace(/\s+/g, ' ');

  let opening: number | null = null;
  let closing: number | null = null;
  const sources: string[] = [];

  // Helper: extrai valor de um match com sinal opcional ± antes do R$
  const parseMatch = (m: RegExpExecArray): number => {
    const sign = m[1] || '';
    const v = normalizeAmount(m[2]);
    const cd = (m[3] || '').toUpperCase();
    if (cd === 'D' || sign === '-' || sign === '−') return -Math.abs(v);
    return v;
  };

  // ---------- SALDO ANTERIOR / INICIAL ----------
  // Cresol: "Saldo Anterior: + R$ 10.882,43"
  // BB/Sicoob/etc: "SALDO ANTERIOR  1.234,56 C"
  const openingRe =
    /saldo\s+(?:anterior|inicial|do\s+per[ií]odo\s+anterior)\s*:?\s*([+\-−])?\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD]?)/gi;
  let openMatch: RegExpExecArray | null;
  // Para Cresol o "Saldo Anterior" aparece no FIM do PDF (ordem reversa) —
  // pegamos a ÚLTIMA ocorrência, que é a mais confiável.
  while ((openMatch = openingRe.exec(flat)) !== null) {
    opening = parseMatch(openMatch);
    sources.push(`opening<-${openMatch[0].slice(0, 60)}`);
  }

  // ---------- SALDO FINAL / ATUAL ----------
  // Cresol: cabeçalho "Saldo em Conta R$ 5.441,70" → saldo final atual
  // Cresol: "Saldo do Dia: + R$ X" do dia mais recente (primeiro no PDF) também serve
  const closingPatterns: RegExp[] = [
    // "Saldo em Conta R$ 5.441,70" (Cresol — cabeçalho)
    /saldo\s+em\s+conta\s*:?\s*([+\-−])?\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD]?)/gi,
    // "Saldo Disponível R$ 5.441,70" (Cresol)
    /saldo\s+dispon[ií]vel\s*:?\s*([+\-−])?\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD]?)/gi,
    // Saldo final / atual / em DD/MM (BB, Sicoob, Itaú etc.)
    /saldo\s+(?:final|atual|em\s+\d{2}\/\d{2}(?:\/\d{4})?)\s*:?\s*([+\-−])?\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD]?)/gi,
    // "Saldo do Dia: + R$ X" — Cresol; pega a PRIMEIRA ocorrência (dia mais recente)
    /saldo\s+do\s+dia\s*:?\s*([+\-−])?\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD]?)/gi,
  ];

  for (const re of closingPatterns) {
    if (closing !== null) break;
    const m = re.exec(flat);
    if (m) {
      closing = parseMatch(m);
      sources.push(`closing<-${m[0].slice(0, 60)}`);
    }
  }

  return { opening, closing, source: sources.join(' | ') };
}

export interface ReconciliationResult {
  ok: boolean;
  hasOpening: boolean;
  hasClosing: boolean;
  expectedClosing: number | null;
  actualClosing: number | null;
  difference: number | null;
  totalCredits: number;
  totalDebits: number;
  message: string;
}

/** Valida se inicial + C − D = final. */
export function reconcile(
  transactions: ExtractedTransaction[],
  balances: StatementBalances,
): ReconciliationResult {
  const totalCredits = transactions
    .filter(t => t.type === 'CREDIT')
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = transactions
    .filter(t => t.type === 'DEBIT')
    .reduce((s, t) => s + t.amount, 0);

  const hasOpening = balances.opening !== null;
  const hasClosing = balances.closing !== null;

  if (!hasOpening || !hasClosing) {
    return {
      ok: true, // sem dados não há como invalidar
      hasOpening,
      hasClosing,
      expectedClosing: null,
      actualClosing: balances.closing,
      difference: null,
      totalCredits,
      totalDebits,
      message: 'Saldo inicial/final não detectado no PDF — conciliação não verificada.',
    };
  }

  // Cálculo exato em centavos — sem arredondamento/tolerância.
  const toCents = (n: number) => Math.round(n * 100);
  const openingC = toCents(balances.opening as number);
  const closingC = toCents(balances.closing as number);
  const creditsC = transactions
    .filter(t => t.type === 'CREDIT')
    .reduce((s, t) => s + toCents(t.amount), 0);
  const debitsC = transactions
    .filter(t => t.type === 'DEBIT')
    .reduce((s, t) => s + toCents(t.amount), 0);
  const expectedC = openingC + creditsC - debitsC;
  const diffC = expectedC - closingC;
  const expected = expectedC / 100;
  const diff = diffC / 100;
  const ok = diffC === 0;

  return {
    ok,
    hasOpening,
    hasClosing,
    expectedClosing: expected,
    actualClosing: balances.closing,
    difference: diff,
    totalCredits,
    totalDebits,
    message: ok
      ? `Conciliação OK: esperado R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} = saldo final R$ ${(balances.closing as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
      : `Inconsistência: esperado R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | saldo final no extrato R$ ${(balances.closing as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | diferença R$ ${diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${diffC} centavos).`,
  };
}

import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { NormalizedTx, ParseResult, MappingConfig } from './types';
import { extractTextFromPDF, detectBank, extractAccountId, extractAgencyId, extractPeriod } from '@/lib/pdf-parser';
import { parseStatementSmart } from '@/lib/bank-parsers';
import { supabase } from '@/integrations/supabase/client';

// ----------- helpers -----------
function parseBRDate(s: string): string {
  const t = String(s || '').trim();
  // YYYY-MM-DD
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = t.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${y}-${m[2]}-${m[1]}`;
  }
  // OFX YYYYMMDD
  m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return t;
}

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  // Detect format: if has both . and , -> last is decimal
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // remove trailing D/C indicator
  const cd = s.match(/([\-+])?\s*([DC])\s*$/i);
  let sign = 1;
  if (cd) {
    if (cd[2].toUpperCase() === 'D') sign = -1;
    s = s.replace(/[DCdc]\s*$/, '').trim();
  }
  if (s.startsWith('(') && s.endsWith(')')) { sign *= -1; s = s.slice(1, -1); }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return n * sign;
}

// ----------- OFX -----------
export function parseOFX(text: string): ParseResult {
  const transactions: NormalizedTx[] = [];
  const bankId = /<BANKID>([^<\r\n]+)/i.exec(text)?.[1]?.trim() || '';
  const acctId = /<ACCTID>([^<\r\n]+)/i.exec(text)?.[1]?.trim() || '';
  const branchId = /<BRANCHID>([^<\r\n]+)/i.exec(text)?.[1]?.trim() || '';
  const dtStart = /<DTSTART>([^<\r\n]+)/i.exec(text)?.[1]?.trim();
  const dtEnd = /<DTEND>([^<\r\n]+)/i.exec(text)?.[1]?.trim();

  // Match each STMTTRN block
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    const get = (tag: string) => new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i').exec(block)?.[1]?.trim() || '';
    const dt = get('DTPOSTED');
    const amt = parseAmount(get('TRNAMT'));
    const memo = get('MEMO') || get('NAME');
    const fitid = get('FITID');
    const checknum = get('CHECKNUM');
    transactions.push({
      data: parseBRDate(dt),
      descricao: memo,
      documento: checknum || fitid,
      valor: Math.abs(amt),
      tipo: amt >= 0 ? 'entrada' : 'saida',
      saldo: null,
      banco: bankId,
      agencia: branchId,
      conta: acctId,
      categoria: '',
      contaContabilDebito: '',
      contaContabilCredito: '',
      historicoContabil: '',
      centroCusto: '',
      status: 'pendente',
    });
  }
  return {
    transactions,
    bank: bankId,
    agency: branchId,
    account: acctId,
    periodStart: dtStart ? parseBRDate(dtStart) : undefined,
    periodEnd: dtEnd ? parseBRDate(dtEnd) : undefined,
  };
}

// ----------- CSV / TXT -----------
export interface CsvParseOptions {
  delimiter?: string;
  startLine?: number;       // 1-based
  mapping: MappingConfig;
  bank?: string;
  agency?: string;
  account?: string;
}

export function parseCSV(text: string, opts: CsvParseOptions): ParseResult {
  const delimiter = opts.delimiter || autoDetectDelimiter(text);
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: true });
  const rows = parsed.data as string[][];
  const startLine = Math.max(1, opts.startLine || 1);
  // header is first line; data starts at startLine+1 if header present at line 1
  const header = rows[startLine - 1] || [];
  const dataRows = rows.slice(startLine);
  return {
    transactions: mapRowsToTx(header, dataRows, opts.mapping, {
      bank: opts.bank, agency: opts.agency, account: opts.account,
    }),
    bank: opts.bank, agency: opts.agency, account: opts.account,
  };
}

function autoDetectDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const counts = [';', ',', '\t', '|'].map(d => ({ d, n: (sample.match(new RegExp(`\\${d}`, 'g')) || []).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ';';
}

// ----------- XLSX / XLS -----------
export function parseXLSX(buffer: ArrayBuffer, opts: CsvParseOptions): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const startLine = Math.max(1, opts.startLine || 1);
  const header = (rows[startLine - 1] || []).map(String);
  const dataRows = rows.slice(startLine).map(r => (r || []).map(String));
  return {
    transactions: mapRowsToTx(header, dataRows, opts.mapping, {
      bank: opts.bank, agency: opts.agency, account: opts.account,
    }),
    bank: opts.bank, agency: opts.agency, account: opts.account,
  };
}

// ----------- Mapping helper -----------
function mapRowsToTx(
  header: string[],
  rows: string[][],
  mapping: MappingConfig,
  ctx: { bank?: string; agency?: string; account?: string }
): NormalizedTx[] {
  const idx = (col?: string) => {
    if (!col) return -1;
    return header.findIndex(h => String(h).trim().toLowerCase() === col.trim().toLowerCase());
  };
  const iData = idx(mapping.data);
  const iDesc = idx(mapping.descricao);
  const iDoc = idx(mapping.documento);
  const iVal = idx(mapping.valor);
  const iEnt = idx(mapping.entrada);
  const iSai = idx(mapping.saida);
  const iSaldo = idx(mapping.saldo);

  const out: NormalizedTx[] = [];
  for (const r of rows) {
    if (!r || r.every(c => !String(c || '').trim())) continue;
    const dataRaw = iData >= 0 ? r[iData] : '';
    const dataIso = parseBRDate(String(dataRaw));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) continue;
    const desc = iDesc >= 0 ? String(r[iDesc] || '') : '';
    const doc = iDoc >= 0 ? String(r[iDoc] || '') : '';
    let valor = 0;
    let tipo: 'entrada' | 'saida' = 'saida';
    if (iEnt >= 0 || iSai >= 0) {
      const ent = iEnt >= 0 ? parseAmount(r[iEnt]) : 0;
      const sai = iSai >= 0 ? parseAmount(r[iSai]) : 0;
      if (Math.abs(ent) > 0) { valor = Math.abs(ent); tipo = 'entrada'; }
      else if (Math.abs(sai) > 0) { valor = Math.abs(sai); tipo = 'saida'; }
      else continue;
    } else if (iVal >= 0) {
      const v = parseAmount(r[iVal]);
      if (v === 0) continue;
      valor = Math.abs(v);
      tipo = v >= 0 ? 'entrada' : 'saida';
    } else continue;
    const saldo = iSaldo >= 0 ? parseAmount(r[iSaldo]) : null;
    out.push({
      data: dataIso,
      descricao: desc.trim(),
      documento: doc.trim(),
      valor,
      tipo,
      saldo: iSaldo >= 0 ? saldo : null,
      banco: ctx.bank || '',
      agencia: ctx.agency || '',
      conta: ctx.account || '',
      categoria: '',
      contaContabilDebito: '',
      contaContabilCredito: '',
      historicoContabil: '',
      centroCusto: '',
      status: 'pendente',
    });
  }
  return out;
}

// ----------- File hash for dedup -----------
export async function fileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ----------- PDF -----------
function isoFromYYYYMMDD(s: string): string {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : parseBRDate(s);
}

function pdfTxToNormalized(
  txs: Array<{ date: string; description: string; document: string; amount: number; type: 'CREDIT' | 'DEBIT'; balance?: number }>,
  ctx: { bank?: string; agency?: string; account?: string }
): NormalizedTx[] {
  return txs.map(t => ({
    data: isoFromYYYYMMDD(t.date),
    descricao: (t.description || '').trim(),
    documento: (t.document || '').trim(),
    valor: Math.abs(t.amount),
    tipo: t.type === 'CREDIT' ? 'entrada' : 'saida',
    saldo: typeof t.balance === 'number' ? t.balance : null,
    banco: ctx.bank || '',
    agencia: ctx.agency || '',
    conta: ctx.account || '',
    categoria: '',
    contaContabilDebito: '',
    contaContabilCredito: '',
    historicoContabil: '',
    centroCusto: '',
    status: 'pendente',
  }));
}

export interface PdfParseOptions {
  bank?: string;
  agency?: string;
  account?: string;
  tenantId?: string | null;
  /** Quando true, força OCR via edge function mesmo se houver texto extraído */
  forceOcr?: boolean;
}

/**
 * Faz o parse de um PDF de extrato bancário.
 * 1) Tenta extrair texto via pdf.js (PDFs nativos).
 * 2) Se vier vazio (PDF escaneado), faz fallback para OCR via edge function ocr-pdf-statement.
 */
export async function parsePDF(file: File, opts: PdfParseOptions = {}): Promise<ParseResult> {
  let text = '';
  if (!opts.forceOcr) {
    try {
      const pages = await extractTextFromPDF(file);
      text = pages.join('\n');
    } catch (e) {
      console.warn('[parsePDF] extração local falhou, tentando OCR', e);
    }
  }

  // Heurística: se o texto for muito curto ou não tiver dígitos, o PDF é provavelmente escaneado.
  const looksEmpty = !text || text.replace(/\s+/g, '').length < 30 || (text.match(/\d/g) || []).length < 10;
  if (looksEmpty) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const fileBase64 = btoa(binary);
    const { data, error } = await supabase.functions.invoke('ocr-pdf-statement', {
      body: { fileBase64, fileName: file.name, tenant_id: opts.tenantId || undefined },
    });
    if (error) throw new Error(error.message || 'Falha no OCR do PDF.');
    if (data?.error) throw new Error(data.error);
    text = String(data?.text || '');
    if (!text) throw new Error('OCR não retornou conteúdo legível.');
  }

  const ctx = {
    bank: opts.bank || detectBank(text) || '',
    agency: opts.agency || extractAgencyId(text) || '',
    account: opts.account || extractAccountId(text) || '',
  };
  const period = extractPeriod(text);
  const raw = parseStatementSmart(text);
  const transactions = pdfTxToNormalized(raw, ctx);

  return {
    transactions,
    bank: ctx.bank,
    agency: ctx.agency,
    account: ctx.account,
    periodStart: period.start ? isoFromYYYYMMDD(period.start) : undefined,
    periodEnd: period.end ? isoFromYYYYMMDD(period.end) : undefined,
  };
}

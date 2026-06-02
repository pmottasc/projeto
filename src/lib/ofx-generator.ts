/**
 * Gerador de arquivos OFX 1.0.2 (SGML)
 * Compatível com sistemas contábeis brasileiros (Domínio, Alterdata, Contmatic).
 */
import type { ExtractedTransaction } from './pdf-parser';

/** Gera FITID único determinístico baseado em hash do conteúdo */
function generateFitId(t: ExtractedTransaction, index: number): string {
  const seed = `${t.date}|${t.amount.toFixed(2)}|${t.type}|${t.description}|${index}`;
  // Hash FNV-1a simples (32-bit)
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // 8 chars hex + data + index → garante unicidade
  return `${t.date}${index.toString().padStart(4, '0')}${h.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** Dados bancários para o OFX */
export interface OFXBankInfo {
  bankId: string;      // Código do banco (ex: "001" para BB)
  accountId: string;   // Número da conta
  accountType: 'CHECKING' | 'SAVINGS';
  branchId?: string;   // Agência (opcional)
}

/** Códigos FEBRABAN dos bancos */
const BANK_CODES: Record<string, string> = {
  bb: '001',
  caixa: '104',
  bradesco: '237',
  itau: '341',
  santander: '033',
  sicoob: '756',
  sicredi: '748',
  inter: '077',
  nubank: '260',
  c6: '336',
};

/**
 * Gera o conteúdo do arquivo OFX 1.0.2 (SGML)
 */
export function generateOFX(
  transactions: ExtractedTransaction[],
  bankInfo: OFXBankInfo,
  bankKey: string,
): string {
  if (transactions.length === 0) return '';

  // Ordenar transações por data
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  const dtStart = sorted[0].date;
  const dtEnd = sorted[sorted.length - 1].date;

  const bankCode = BANK_CODES[bankKey] || bankInfo.bankId || '000';
  const acctId = (bankInfo.accountId || '000000').replace(/[^\d]/g, '') || '000000';
  const dtServer = formatOFXDate(new Date());

  // Saldo final calculado (ledger balance) baseado nas transações
  const balance = sorted.reduce((sum, t) => {
    return sum + (t.type === 'CREDIT' ? t.amount : -t.amount);
  }, 0);

  // Gerar transações (formato SGML — sem tags de fechamento em campos folha)
  const transactionEntries = sorted.map((t, i) => {
    const trnAmt = (t.type === 'DEBIT' ? -t.amount : t.amount).toFixed(2);
    const fitId = generateFitId(t, i);
    const memo = escapeOFX(t.description).substring(0, 255);
    const checkNum = t.document ? `\n          <CHECKNUM>${escapeOFX(t.document)}` : '';

    return `        <STMTTRN>
          <TRNTYPE>${t.type}
          <DTPOSTED>${t.date}000000[-03:BRT]
          <TRNAMT>${trnAmt}
          <FITID>${fitId}${checkNum}
          <MEMO>${memo}
        </STMTTRN>`;
  }).join('\n');

  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0
        <SEVERITY>INFO
      </STATUS>
      <DTSERVER>${dtServer}[-03:BRT]
      <LANGUAGE>POR
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1
      <STATUS>
        <CODE>0
        <SEVERITY>INFO
      </STATUS>
      <STMTRS>
        <CURDEF>BRL
        <BANKACCTFROM>
          <BANKID>${bankCode}
          <ACCTID>${acctId}
          <ACCTTYPE>${bankInfo.accountType}
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${dtStart}000000[-03:BRT]
          <DTEND>${dtEnd}000000[-03:BRT]
${transactionEntries}
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>${balance.toFixed(2)}
          <DTASOF>${dtEnd}000000[-03:BRT]
        </LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;
}

/** Formata data para OFX: YYYYMMDDHHMMSS */
function formatOFXDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

/** Escapa caracteres especiais para OFX e remove acentos (CHARSET 1252 ASCII-safe) */
function escapeOFX(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Faz download do arquivo OFX */
export function downloadOFX(content: string, filename: string = 'extrato_convertido.ofx') {
  const blob = new Blob([content], { type: 'application/x-ofx;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

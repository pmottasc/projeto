import * as XLSX from 'xlsx';
import type { NormalizedTx } from './types';

interface ExportCtx { companyName?: string }

function rows(txs: NormalizedTx[], ctx: ExportCtx) {
  return txs.filter(t => !t.status.includes('erro')).map(t => ({
    Data: t.data,
    'Conta Débito': t.contaContabilDebito,
    'Conta Crédito': t.contaContabilCredito,
    Valor: t.valor,
    Histórico: t.historicoContabil,
    Documento: t.documento,
    'Centro de Custo': t.centroCusto,
    Empresa: ctx.companyName || '',
    Categoria: t.categoria,
    Origem: 'Extrato Bancário',
  }));
}

export function exportXLSX(txs: NormalizedTx[], filename: string, ctx: ExportCtx = {}) {
  const data = rows(txs, ctx);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos');
  XLSX.writeFile(wb, filename);
}

export function exportCSV(txs: NormalizedTx[], filename: string, ctx: ExportCtx = {}) {
  const data = rows(txs, ctx);
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const body = data.map(r => headers.map(h => {
    const v = String((r as any)[h] ?? '').replace(/"/g, '""');
    return /[;"\n]/.test(v) ? `"${v}"` : v;
  }).join(';'));
  const csv = [headers.join(';'), ...body].join('\n');
  download(filename, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
}

export function exportJSON(txs: NormalizedTx[], filename: string, ctx: ExportCtx = {}) {
  const data = rows(txs, ctx);
  download(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

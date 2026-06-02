import type { NormalizedTx, RuleRow, FixedRules } from './types';

function matches(desc: string, rule: RuleRow): boolean {
  const d = desc.toLowerCase();
  const k = rule.keyword.toLowerCase().trim();
  if (!k) return false;
  switch (rule.match_type) {
    case 'starts_with': return d.startsWith(k);
    case 'ends_with': return d.endsWith(k);
    case 'equals': return d === k;
    default: return d.includes(k);
  }
}

export function applyRules(
  txs: NormalizedTx[],
  rules: RuleRow[],
  fixed: FixedRules = {}
): NormalizedTx[] {
  const sorted = [...rules].filter(r => r.active).sort((a, b) => a.priority - b.priority);
  return txs.map(tx => {
    if (tx.status === 'classificado') return tx;
    const next = { ...tx };
    // 1) regras fixas
    if (fixed.defaultDebitAccount) next.contaContabilDebito = fixed.defaultDebitAccount;
    if (fixed.defaultCreditAccount) next.contaContabilCredito = fixed.defaultCreditAccount;
    if (fixed.defaultHistory) next.historicoContabil = fixed.defaultHistory;
    if (fixed.defaultCategory) next.categoria = fixed.defaultCategory;
    if (fixed.defaultCostCenter) next.centroCusto = fixed.defaultCostCenter;
    // 2) regras por keyword (sobrescrevem)
    for (const r of sorted) {
      if (r.transaction_type !== 'ambos' && r.transaction_type !== tx.tipo) continue;
      if (!matches(next.descricao, r)) continue;
      if (r.category) next.categoria = r.category;
      if (r.debit_account) next.contaContabilDebito = r.debit_account;
      if (r.credit_account) next.contaContabilCredito = r.credit_account;
      if (r.accounting_history) next.historicoContabil = r.accounting_history;
      if (r.cost_center) next.centroCusto = r.cost_center;
      break;
    }
    if (next.contaContabilDebito && next.contaContabilCredito && next.historicoContabil) {
      next.status = 'classificado';
    } else {
      next.status = 'pendente';
    }
    return next;
  });
}

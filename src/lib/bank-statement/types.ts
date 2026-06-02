export type TxType = 'entrada' | 'saida';
export type TxStatus = 'pendente' | 'classificado' | 'erro';

export interface NormalizedTx {
  data: string;            // YYYY-MM-DD
  descricao: string;
  documento: string;
  valor: number;           // sempre positivo
  tipo: TxType;
  saldo: number | null;
  banco: string;
  agencia: string;
  conta: string;
  categoria: string;
  contaContabilDebito: string;
  contaContabilCredito: string;
  historicoContabil: string;
  centroCusto: string;
  status: TxStatus;
  raw?: Record<string, unknown>;
}

export interface ParseResult {
  transactions: NormalizedTx[];
  bank?: string;
  agency?: string;
  account?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface MappingConfig {
  data?: string;
  descricao?: string;
  documento?: string;
  valor?: string;
  entrada?: string;
  saida?: string;
  saldo?: string;
}

export interface RuleRow {
  id: string;
  keyword: string;
  match_type: 'contains' | 'starts_with' | 'ends_with' | 'equals';
  transaction_type: 'entrada' | 'saida' | 'ambos';
  category: string;
  debit_account: string;
  credit_account: string;
  accounting_history: string;
  cost_center: string;
  priority: number;
  active: boolean;
}

export interface FixedRules {
  defaultDebitAccount?: string;
  defaultCreditAccount?: string;
  defaultHistory?: string;
  defaultCategory?: string;
  defaultCostCenter?: string;
}

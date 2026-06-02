
-- ============ Empresas (clientes do escritório) ============
CREATE TABLE public.bank_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  trade_name text NOT NULL DEFAULT '',
  cnpj text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_companies_tenant ON public.bank_companies(tenant_id);
ALTER TABLE public.bank_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY bc_admin_manage ON public.bank_companies FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bank_companies_updated BEFORE UPDATE ON public.bank_companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Contas bancárias ============
CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.bank_companies(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  bank_code text NOT NULL DEFAULT '',
  agency text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_type text NOT NULL DEFAULT 'corrente',
  default_debit_account text NOT NULL DEFAULT '',
  default_credit_account text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_accounts_tenant ON public.bank_accounts(tenant_id);
CREATE INDEX idx_bank_accounts_company ON public.bank_accounts(company_id);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ba_admin_manage ON public.bank_accounts FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bank_accounts_updated BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Importações ============
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid REFERENCES public.bank_companies(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_hash text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'em_andamento',
  total_records integer NOT NULL DEFAULT 0,
  imported_records integer NOT NULL DEFAULT 0,
  pending_records integer NOT NULL DEFAULT 0,
  error_records integer NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  fixed_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsi_tenant ON public.bank_statement_imports(tenant_id);
CREATE INDEX idx_bsi_company ON public.bank_statement_imports(company_id);
CREATE UNIQUE INDEX idx_bsi_dedup ON public.bank_statement_imports(tenant_id, company_id, file_hash) WHERE file_hash <> '';
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsi_admin_manage ON public.bank_statement_imports FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bsi_updated BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Lançamentos ============
CREATE TABLE public.bank_statement_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.bank_companies(id) ON DELETE SET NULL,
  transaction_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  document_number text NOT NULL DEFAULT '',
  amount numeric(18,2) NOT NULL DEFAULT 0,
  transaction_type text NOT NULL DEFAULT 'saida',
  balance numeric(18,2),
  category text NOT NULL DEFAULT '',
  debit_account text NOT NULL DEFAULT '',
  credit_account text NOT NULL DEFAULT '',
  accounting_history text NOT NULL DEFAULT '',
  cost_center text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pendente',
  ignored boolean NOT NULL DEFAULT false,
  checked boolean NOT NULL DEFAULT false,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bst_tenant ON public.bank_statement_transactions(tenant_id);
CREATE INDEX idx_bst_import ON public.bank_statement_transactions(import_id);
CREATE INDEX idx_bst_status ON public.bank_statement_transactions(import_id, status);
ALTER TABLE public.bank_statement_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bst_admin_manage ON public.bank_statement_transactions FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bst_updated BEFORE UPDATE ON public.bank_statement_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Modelos de mapeamento ============
CREATE TABLE public.bank_statement_mapping_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid REFERENCES public.bank_companies(id) ON DELETE CASCADE,
  bank_name text NOT NULL DEFAULT '',
  template_name text NOT NULL,
  file_type text NOT NULL DEFAULT 'csv',
  mapping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
  decimal_format text NOT NULL DEFAULT 'pt-BR',
  start_line integer NOT NULL DEFAULT 1,
  delimiter text NOT NULL DEFAULT ';',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsmt_tenant ON public.bank_statement_mapping_templates(tenant_id);
ALTER TABLE public.bank_statement_mapping_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsmt_admin_manage ON public.bank_statement_mapping_templates FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bsmt_updated BEFORE UPDATE ON public.bank_statement_mapping_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Regras de classificação ============
CREATE TABLE public.bank_statement_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid REFERENCES public.bank_companies(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains',
  transaction_type text NOT NULL DEFAULT 'ambos',
  category text NOT NULL DEFAULT '',
  debit_account text NOT NULL DEFAULT '',
  credit_account text NOT NULL DEFAULT '',
  accounting_history text NOT NULL DEFAULT '',
  cost_center text NOT NULL DEFAULT '',
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsr_tenant ON public.bank_statement_rules(tenant_id);
CREATE INDEX idx_bsr_company ON public.bank_statement_rules(company_id);
ALTER TABLE public.bank_statement_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsr_admin_manage ON public.bank_statement_rules FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_bsr_updated BEFORE UPDATE ON public.bank_statement_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Logs de exportação ============
CREATE TABLE public.bank_statement_export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  export_type text NOT NULL,
  file_name text NOT NULL,
  total_records integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsel_tenant ON public.bank_statement_export_logs(tenant_id);
ALTER TABLE public.bank_statement_export_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsel_admin_manage ON public.bank_statement_export_logs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

-- ============ Feature flag ============
INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT id, 'bank_statement', true FROM public.tenants
ON CONFLICT DO NOTHING;

-- Atualiza seed para novos tenants
CREATE OR REPLACE FUNCTION public.seed_tenant_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
  VALUES
    (NEW.id, 'work_links', true),
    (NEW.id, 'central_atendimento', true),
    (NEW.id, 'pdf_to_ofx', true),
    (NEW.id, 'document_converter', true),
    (NEW.id, 'password_vault', true),
    (NEW.id, 'knowledge_base', true),
    (NEW.id, 'ramais', true),
    (NEW.id, 'bank_statement', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

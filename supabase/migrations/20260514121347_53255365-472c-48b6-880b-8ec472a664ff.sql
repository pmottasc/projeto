
-- Tabela de empresas (cadastro reutilizável por tenant, dados do Cartão CNPJ)
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cnpj text NOT NULL,
  razao_social text NOT NULL DEFAULT '',
  nome_fantasia text NOT NULL DEFAULT '',
  situacao text NOT NULL DEFAULT '',
  data_abertura date,
  natureza_juridica text NOT NULL DEFAULT '',
  porte text NOT NULL DEFAULT '',
  capital_social numeric,
  cnae_principal text NOT NULL DEFAULT '',
  cnae_principal_descricao text NOT NULL DEFAULT '',
  cnaes_secundarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  logradouro text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  municipio text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  telefone text NOT NULL DEFAULT '',
  socios jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cnpj)
);

CREATE INDEX idx_companies_tenant ON public.companies(tenant_id);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_admin_manage ON public.companies
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY companies_member_select ON public.companies
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Vínculo tasks → companies
ALTER TABLE public.tasks ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_company ON public.tasks(company_id);

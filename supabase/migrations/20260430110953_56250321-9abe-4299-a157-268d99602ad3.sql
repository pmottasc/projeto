-- Tabela para vincular CNPJs aos telefones dos clientes (validação de acesso)
CREATE TABLE public.wa_contact_cnpjs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  cnpj TEXT NOT NULL,
  razao_social TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, cnpj, phone)
);

CREATE INDEX idx_wa_contact_cnpjs_phone ON public.wa_contact_cnpjs(tenant_id, phone);
CREATE INDEX idx_wa_contact_cnpjs_cnpj ON public.wa_contact_cnpjs(tenant_id, cnpj);

ALTER TABLE public.wa_contact_cnpjs ENABLE ROW LEVEL SECURITY;

CREATE POLICY wcc_admin_manage ON public.wa_contact_cnpjs
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY wcc_member_select ON public.wa_contact_cnpjs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE TRIGGER trg_wcc_updated BEFORE UPDATE ON public.wa_contact_cnpjs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Configuração da API contábil por tenant
CREATE TABLE public.accounting_api_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE,
  provider_name TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  api_token TEXT NOT NULL DEFAULT '',
  auth_header_name TEXT NOT NULL DEFAULT 'Authorization',
  auth_header_prefix TEXT NOT NULL DEFAULT 'Bearer ',
  endpoint_template TEXT NOT NULL DEFAULT '/documents?cnpj={cnpj}&type={tipo}',
  active BOOLEAN NOT NULL DEFAULT false,
  extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_api_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY aac_admin_manage ON public.accounting_api_config
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_aac_updated BEFORE UPDATE ON public.accounting_api_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Log de envios de documentos (auditoria)
CREATE TABLE public.document_delivery_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  conversation_id UUID,
  contact_phone TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ddl_tenant ON public.document_delivery_log(tenant_id, created_at DESC);

ALTER TABLE public.document_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY ddl_admin_select ON public.document_delivery_log
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));
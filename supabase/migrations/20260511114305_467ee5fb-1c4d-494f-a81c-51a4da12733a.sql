
-- ============= Feature flag =============
INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT id, 'consulta_xml', true FROM public.tenants
ON CONFLICT DO NOTHING;

-- Adiciona feature key ao seed para novos tenants
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
    (NEW.id, 'bank_statement', true),
    (NEW.id, 'consulta_xml', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ============= xml_empresas =============
CREATE TABLE IF NOT EXISTS public.xml_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  razao_social text NOT NULL,
  cnpj text NOT NULL,
  codigo_interno text,
  certificado_path text, -- path em xml-certificates bucket
  senha_cifrada text,    -- AES-GCM base64 (iv:cipher)
  nfeio_company_id text, -- id retornado pela NFE.io ao cadastrar empresa
  ultimo_nsu text DEFAULT '0',
  ultima_consulta_at timestamptz,
  cooldown_until timestamptz,
  status text NOT NULL DEFAULT 'ativo',
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_xml_empresas_tenant ON public.xml_empresas(tenant_id);

ALTER TABLE public.xml_empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members select empresas xml"
  ON public.xml_empresas FOR SELECT TO authenticated
  USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "tenant admins insert empresas xml"
  ON public.xml_empresas FOR INSERT TO authenticated
  WITH CHECK (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

CREATE POLICY "tenant admins update empresas xml"
  ON public.xml_empresas FOR UPDATE TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

CREATE POLICY "tenant admins delete empresas xml"
  ON public.xml_empresas FOR DELETE TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

CREATE TRIGGER trg_xml_empresas_updated
  BEFORE UPDATE ON public.xml_empresas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= xml_documentos =============
CREATE TABLE IF NOT EXISTS public.xml_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.xml_empresas(id) ON DELETE CASCADE,
  chave_acesso text NOT NULL,
  nsu text,
  numero text,
  serie text,
  modelo text,
  cnpj_emitente text,
  nome_emitente text,
  cnpj_destinatario text,
  data_emissao timestamptz,
  valor_total numeric(15,2),
  situacao text,
  status_xml text NOT NULL DEFAULT 'resumo', -- resumo|completo|manifestado|erro
  xml_resumo text,
  xml_completo text,
  storage_path text,
  ultima_atualizacao timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, chave_acesso)
);
CREATE INDEX IF NOT EXISTS idx_xml_doc_empresa ON public.xml_documentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_xml_doc_tenant ON public.xml_documentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_xml_doc_emissao ON public.xml_documentos(data_emissao DESC);

ALTER TABLE public.xml_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members select xml docs"
  ON public.xml_documentos FOR SELECT TO authenticated
  USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

-- writes só via edge function (service role bypassa RLS), portanto policies restritivas:
CREATE POLICY "no direct insert xml docs"
  ON public.xml_documentos FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no direct update xml docs"
  ON public.xml_documentos FOR UPDATE TO authenticated USING (false);
CREATE POLICY "tenant admins delete xml docs"
  ON public.xml_documentos FOR DELETE TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

CREATE TRIGGER trg_xml_documentos_updated
  BEFORE UPDATE ON public.xml_documentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= xml_manifestacoes =============
CREATE TABLE IF NOT EXISTS public.xml_manifestacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  documento_id uuid NOT NULL REFERENCES public.xml_documentos(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- ciencia|confirmacao|desconhecimento|nao_realizada
  protocolo text,
  status text,
  mensagem text,
  data_manifestacao timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xml_manif_doc ON public.xml_manifestacoes(documento_id);

ALTER TABLE public.xml_manifestacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members select xml manif"
  ON public.xml_manifestacoes FOR SELECT TO authenticated
  USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "no direct insert xml manif"
  ON public.xml_manifestacoes FOR INSERT TO authenticated WITH CHECK (false);

CREATE TRIGGER trg_xml_manif_updated
  BEFORE UPDATE ON public.xml_manifestacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= xml_consulta_logs =============
CREATE TABLE IF NOT EXISTS public.xml_consulta_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.xml_empresas(id) ON DELETE SET NULL,
  user_id uuid,
  acao text NOT NULL, -- consulta|download|manifestacao|cadastro
  status text NOT NULL, -- ok|erro|bloqueado
  mensagem text,
  qtd_documentos integer DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xml_logs_tenant ON public.xml_consulta_logs(tenant_id, created_at DESC);

ALTER TABLE public.xml_consulta_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant admins select xml logs"
  ON public.xml_consulta_logs FOR SELECT TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

CREATE POLICY "no direct write xml logs"
  ON public.xml_consulta_logs FOR INSERT TO authenticated WITH CHECK (false);

-- ============= xml_user_permissions =============
CREATE TABLE IF NOT EXISTS public.xml_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('visualizar','consultar','baixar','manifestar','configurar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, permission)
);

ALTER TABLE public.xml_user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members select own xml perms"
  ON public.xml_user_permissions FOR SELECT TO authenticated
  USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "tenant admins manage xml perms"
  ON public.xml_user_permissions FOR ALL TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()))
  WITH CHECK (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin(auth.uid()));

-- Helper: usuário tem permissão? (admin/TI = sempre true)
CREATE OR REPLACE FUNCTION public.xml_has_permission(_user_id uuid, _tenant_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_admin_or_supervisor(_user_id)
    OR public.user_is_tenant_admin(_user_id, _tenant_id)
    OR public.is_platform_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.xml_user_permissions
      WHERE user_id = _user_id AND tenant_id = _tenant_id AND permission = _perm
    )
$$;

-- ============= Storage bucket xml-certificates (privado) =============
INSERT INTO storage.buckets (id, name, public)
VALUES ('xml-certificates', 'xml-certificates', false)
ON CONFLICT (id) DO NOTHING;

-- só service role acessa (edge functions). Sem policies para authenticated → bloqueado.
CREATE POLICY "deny all xml certs to anon"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id <> 'xml-certificates');

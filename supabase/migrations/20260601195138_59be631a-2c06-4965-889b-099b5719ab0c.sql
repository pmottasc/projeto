
-- Consulta XML: extensão de schema (additive, sem perda de dados)

-- 1. xml_empresas: campos adicionais
ALTER TABLE public.xml_empresas
  ADD COLUMN IF NOT EXISTS nome_fantasia text,
  ADD COLUMN IF NOT EXISTS inscricao_estadual text,
  ADD COLUMN IF NOT EXISTS uf text,
  ADD COLUMN IF NOT EXISTS codigo_jb text,
  ADD COLUMN IF NOT EXISTS ultimo_nsu_nfe text DEFAULT '0',
  ADD COLUMN IF NOT EXISTS ultimo_nsu_cte text DEFAULT '0',
  ADD COLUMN IF NOT EXISTS data_ultima_consulta_nfe timestamptz,
  ADD COLUMN IF NOT EXISTS data_ultima_consulta_cte timestamptz,
  ADD COLUMN IF NOT EXISTS bloqueado_ate timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text,
  ADD COLUMN IF NOT EXISTS certificado_id uuid,
  ADD COLUMN IF NOT EXISTS agendamento_noturno boolean NOT NULL DEFAULT false;

-- migrar ultimo_nsu legado para ultimo_nsu_nfe quando faltar
UPDATE public.xml_empresas
   SET ultimo_nsu_nfe = COALESCE(NULLIF(ultimo_nsu_nfe,'0'), ultimo_nsu)
 WHERE ultimo_nsu IS NOT NULL AND (ultimo_nsu_nfe IS NULL OR ultimo_nsu_nfe = '0');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'xml_empresas_certificado_fk'
  ) THEN
    ALTER TABLE public.xml_empresas
      ADD CONSTRAINT xml_empresas_certificado_fk
      FOREIGN KEY (certificado_id) REFERENCES public.digital_certificates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. xml_documentos: campos adicionais
ALTER TABLE public.xml_documentos
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'NFE',
  ADD COLUMN IF NOT EXISTS nome_destinatario text,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'DISTRIBUICAO_DFE',
  ADD COLUMN IF NOT EXISTS manifestado boolean NOT NULL DEFAULT false;

-- 3. xml_consulta_logs: campos adicionais
ALTER TABLE public.xml_consulta_logs
  ADD COLUMN IF NOT EXISTS tipo_consulta text,
  ADD COLUMN IF NOT EXISTS cstat text,
  ADD COLUMN IF NOT EXISTS xmotivo text,
  ADD COLUMN IF NOT EXISTS nsu_inicial text,
  ADD COLUMN IF NOT EXISTS nsu_final text,
  ADD COLUMN IF NOT EXISTS bloqueado_ate timestamptz;

-- 4. lock por CNPJ para evitar consultas simultâneas
CREATE TABLE IF NOT EXISTS public.xml_consulta_lock (
  cnpj text PRIMARY KEY,
  empresa_id uuid REFERENCES public.xml_empresas(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  owner text
);

GRANT SELECT ON public.xml_consulta_lock TO authenticated;
GRANT ALL ON public.xml_consulta_lock TO service_role;

ALTER TABLE public.xml_consulta_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read xml lock"
  ON public.xml_consulta_lock FOR SELECT
  TO authenticated
  USING (user_belongs_to_tenant(auth.uid(), tenant_id));

-- 5. storage bucket privado para XMLs baixados
INSERT INTO storage.buckets (id, name, public)
VALUES ('xml-storage', 'xml-storage', false)
ON CONFLICT (id) DO NOTHING;

-- Policies para xml-storage: somente service_role escreve (via edge fn);
-- membros do tenant leem via signed URL gerada pela edge function.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'xml_storage_tenant_read' AND tablename='objects' AND schemaname='storage') THEN
    CREATE POLICY "xml_storage_tenant_read"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'xml-storage');
  END IF;
END $$;

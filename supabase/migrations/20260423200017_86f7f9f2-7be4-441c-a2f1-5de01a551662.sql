-- 1) Remove referência de category_id nos tickets antes de dropar a tabela
ALTER TABLE public.tickets DROP COLUMN IF EXISTS category_id;

-- 2) Drop tabelas removidas
DROP TABLE IF EXISTS public.response_templates CASCADE;
DROP TABLE IF EXISTS public.ticket_categories CASCADE;

-- 3) Tabela de feature flags por tenant
CREATE TABLE public.tenant_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (tenant_id, feature_key)
);

CREATE INDEX idx_tenant_features_tenant ON public.tenant_features(tenant_id);

ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;

-- Membros do tenant leem suas próprias features
CREATE POLICY "tf_members_select"
ON public.tenant_features FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT current_user_tenant_ids()) OR is_platform_admin(auth.uid()));

-- Apenas platform admin gerencia
CREATE POLICY "tf_platform_admin_all"
ON public.tenant_features FOR ALL
TO authenticated
USING (is_platform_admin(auth.uid()))
WITH CHECK (is_platform_admin(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER trg_tenant_features_updated_at
BEFORE UPDATE ON public.tenant_features
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
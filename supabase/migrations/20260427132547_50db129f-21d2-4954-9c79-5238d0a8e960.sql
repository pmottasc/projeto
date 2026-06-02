-- Tabela de links de trabalho (atalhos) por tenant
CREATE TABLE public.work_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  icon_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_links_tenant ON public.work_links(tenant_id, position);

ALTER TABLE public.work_links ENABLE ROW LEVEL SECURITY;

-- Membros do tenant podem visualizar
CREATE POLICY "wl_tenant_select"
ON public.work_links FOR SELECT TO authenticated
USING (tenant_id IN (SELECT current_user_tenant_ids()));

-- Apenas platform admin pode gerenciar
CREATE POLICY "wl_platform_admin_all"
ON public.work_links FOR ALL TO authenticated
USING (is_platform_admin(auth.uid()))
WITH CHECK (is_platform_admin(auth.uid()));

CREATE TRIGGER update_work_links_updated_at
BEFORE UPDATE ON public.work_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
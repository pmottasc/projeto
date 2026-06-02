-- Tenant branding: logo + cores customizadas por tenant
CREATE TABLE IF NOT EXISTS public.tenant_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  logo_url text NOT NULL DEFAULT '',
  logo_path text NOT NULL DEFAULT '',
  primary_hsl text NOT NULL DEFAULT '215 95% 56%',
  accent_hsl text NOT NULL DEFAULT '268 78% 58%',
  secondary_hsl text NOT NULL DEFAULT '328 88% 56%',
  use_gradient boolean NOT NULL DEFAULT true,
  app_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

-- Apenas SuperAdmin (platform admin) gerencia
CREATE POLICY tb_brand_admin_all ON public.tenant_branding
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

-- Membros do tenant podem LER seu branding (para aplicar no app)
CREATE POLICY tb_brand_member_select ON public.tenant_branding
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE TRIGGER trg_tenant_branding_updated_at
BEFORE UPDATE ON public.tenant_branding
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bucket público para logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: leitura pública, escrita apenas SuperAdmin
CREATE POLICY "Tenant logos public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'tenant-logos');

CREATE POLICY "Tenant logos superadmin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tenant-logos' AND is_platform_admin(auth.uid()));

CREATE POLICY "Tenant logos superadmin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'tenant-logos' AND is_platform_admin(auth.uid()));

CREATE POLICY "Tenant logos superadmin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tenant-logos' AND is_platform_admin(auth.uid()));

-- Digital certificates vault
CREATE TABLE IF NOT EXISTS public.digital_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  owner text NOT NULL DEFAULT '',
  cnpj text NOT NULL DEFAULT '',
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'application/x-pkcs12',
  certificate_password text NOT NULL DEFAULT '',
  expires_at date,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digital_certificates_tenant ON public.digital_certificates(tenant_id);

ALTER TABLE public.digital_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_admin_manage ON public.digital_certificates FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_digital_certificates_updated_at
  BEFORE UPDATE ON public.digital_certificates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('digital-certificates', 'digital-certificates', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dc_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'digital-certificates' AND user_is_tenant_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "dc_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'digital-certificates' AND user_is_tenant_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "dc_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'digital-certificates' AND user_is_tenant_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

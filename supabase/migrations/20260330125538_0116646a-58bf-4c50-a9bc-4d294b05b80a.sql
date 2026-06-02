
CREATE TABLE public.passwords_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  service_type text NOT NULL DEFAULT 'outro',
  login_email text NOT NULL DEFAULT '',
  login_username text NOT NULL DEFAULT '',
  login_password text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.passwords_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TI can select vault" ON public.passwords_vault
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ti')
  );

CREATE POLICY "TI can insert vault" ON public.passwords_vault
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ti')
  );

CREATE POLICY "TI can update vault" ON public.passwords_vault
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ti')
  );

CREATE POLICY "TI can delete vault" ON public.passwords_vault
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'ti')
  );

CREATE TRIGGER update_passwords_vault_updated_at
  BEFORE UPDATE ON public.passwords_vault
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

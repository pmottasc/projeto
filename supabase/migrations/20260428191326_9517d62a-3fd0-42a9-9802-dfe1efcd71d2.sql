CREATE TABLE IF NOT EXISTS public.profile_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  department_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_departments_user ON public.profile_departments(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_departments_tenant ON public.profile_departments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profile_departments_dep ON public.profile_departments(department_id);

ALTER TABLE public.profile_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY pd_member_select ON public.profile_departments
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY pd_admin_manage ON public.profile_departments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

-- Backfill: copiar setor primário existente para a tabela de junção
INSERT INTO public.profile_departments (tenant_id, user_id, department_id)
SELECT tm.tenant_id, p.user_id, p.department_id
FROM public.profiles p
JOIN public.tenant_members tm ON tm.user_id = p.user_id
WHERE p.department_id IS NOT NULL
ON CONFLICT (user_id, department_id) DO NOTHING;
-- Departments (setores) per tenant for routing of WhatsApp conversations
CREATE TABLE public.departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_departments_tenant ON public.departments(tenant_id);
CREATE UNIQUE INDEX uq_departments_tenant_name ON public.departments(tenant_id, lower(name));

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY dep_member_select ON public.departments
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY dep_admin_manage ON public.departments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link users (profiles) to a department
ALTER TABLE public.profiles
  ADD COLUMN department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_department ON public.profiles(department_id);

-- Link WhatsApp conversations to a department (for queue routing)
ALTER TABLE public.wa_conversations
  ADD COLUMN department_id UUID NULL REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX idx_wa_conv_department ON public.wa_conversations(department_id);

-- Allow members of the department to view unassigned conversations targeted to their department
DROP POLICY IF EXISTS waconv_select ON public.wa_conversations;
CREATE POLICY waconv_select ON public.wa_conversations
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      user_is_tenant_admin(auth.uid(), tenant_id)
      OR assignee_id IS NULL
      OR assignee_id = auth.uid()
      OR (
        department_id IS NOT NULL
        AND department_id IN (SELECT department_id FROM public.profiles WHERE user_id = auth.uid() AND department_id IS NOT NULL)
      )
    )
  );

DROP POLICY IF EXISTS waconv_update ON public.wa_conversations;
CREATE POLICY waconv_update ON public.wa_conversations
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      user_is_tenant_admin(auth.uid(), tenant_id)
      OR assignee_id = auth.uid()
      OR assignee_id IS NULL
      OR (
        department_id IS NOT NULL
        AND department_id IN (SELECT department_id FROM public.profiles WHERE user_id = auth.uid() AND department_id IS NOT NULL)
      )
    )
  )
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()));

-- =========================================================
-- 0) Dropar políticas que dependem de is_admin_or_ti
-- =========================================================
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin/TI can upload kb media" ON storage.objects;
DROP POLICY IF EXISTS "Admin/TI can delete kb media" ON storage.objects;

-- =========================================================
-- 1) NOVO ENUM app_role (admin, supervisor, user)
-- =========================================================
ALTER TYPE public.app_role RENAME TO app_role_old;
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'user');

ALTER TABLE public.user_roles
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE public.app_role
  USING (
    CASE role::text
      WHEN 'ti' THEN 'admin'::public.app_role
      WHEN 'admin' THEN 'admin'::public.app_role
      ELSE 'user'::public.app_role
    END
  ),
  ALTER COLUMN role SET DEFAULT 'user'::public.app_role;

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role_old);
DROP FUNCTION IF EXISTS public.is_admin_or_ti(uuid);
DROP TYPE public.app_role_old;

-- =========================================================
-- 2) Novas funções de role
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_supervisor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','supervisor'))
$$;

-- alias retrocompatível
CREATE OR REPLACE FUNCTION public.is_admin_or_ti(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin_or_supervisor(_user_id)
$$;

-- =========================================================
-- 3) Recriar políticas removidas
-- =========================================================
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_admin_or_supervisor(auth.uid()))
  WITH CHECK (public.is_admin_or_supervisor(auth.uid()));

CREATE POLICY "Admin manage all roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Supervisor view roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_admin_or_supervisor(auth.uid()));

CREATE POLICY "Supervisor insert non-admin roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'supervisor')
    AND role <> 'admin'
    AND NOT public.is_admin(user_id)
  );

CREATE POLICY "Supervisor update non-admin roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'supervisor')
    AND NOT public.is_admin(user_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'supervisor')
    AND role <> 'admin'
  );

CREATE POLICY "Supervisor delete non-admin roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'supervisor')
    AND NOT public.is_admin(user_id)
  );

CREATE POLICY "Admin/Supervisor can upload kb media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kb-media' AND public.is_admin_or_supervisor(auth.uid()));

CREATE POLICY "Admin/Supervisor can delete kb media" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'kb-media' AND public.is_admin_or_supervisor(auth.uid()));

-- =========================================================
-- 4) STATUS 'cancelado'
-- =========================================================
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'cancelado';

-- =========================================================
-- 5) Categorias / Tipos / SLA
-- =========================================================
CREATE TABLE IF NOT EXISTS public.ticket_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcat_select ON public.ticket_categories FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY tcat_manage ON public.ticket_categories FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids())
         AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids())
              AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())));
CREATE TRIGGER trg_tcat_updated BEFORE UPDATE ON public.ticket_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ttyp_select ON public.ticket_types FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY ttyp_manage ON public.ticket_types FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids())
         AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids())
              AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())));
CREATE TRIGGER trg_ttyp_updated BEFORE UPDATE ON public.ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  urgency public.urgency_level,
  category_id uuid REFERENCES public.ticket_categories(id) ON DELETE SET NULL,
  first_response_minutes integer NOT NULL DEFAULT 240,
  resolution_minutes integer NOT NULL DEFAULT 1440,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_select ON public.sla_policies FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY sla_manage ON public.sla_policies FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids())
         AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids())
              AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_admin_or_supervisor(auth.uid())));
CREATE TRIGGER trg_sla_updated BEFORE UPDATE ON public.sla_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 6) Novas colunas em tickets
-- =========================================================
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.ticket_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.ticket_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_policy_id uuid REFERENCES public.sla_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_category ON public.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_type ON public.tickets(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_tickets_sla ON public.tickets(sla_policy_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_created ON public.tickets(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_ticket_sla()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  policy public.sla_policies%ROWTYPE;
BEGIN
  IF NEW.sla_policy_id IS NULL THEN
    SELECT * INTO policy FROM public.sla_policies
    WHERE tenant_id = NEW.tenant_id AND active = true
      AND (urgency IS NULL OR urgency = NEW.urgency)
      AND (category_id IS NULL OR category_id = NEW.category_id)
    ORDER BY ((urgency IS NOT NULL)::int + (category_id IS NOT NULL)::int) DESC, created_at ASC
    LIMIT 1;
    IF FOUND THEN
      NEW.sla_policy_id := policy.id;
      NEW.first_response_due_at := NEW.created_at + (policy.first_response_minutes || ' minutes')::interval;
      NEW.resolution_due_at     := NEW.created_at + (policy.resolution_minutes     || ' minutes')::interval;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_ticket_sla ON public.tickets;
CREATE TRIGGER trg_apply_ticket_sla
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.apply_ticket_sla();


-- Audit log table
CREATE TABLE public.user_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  target_user_id uuid NOT NULL,
  performed_by uuid,
  action text NOT NULL, -- role_assigned, role_removed, role_changed, user_activated, user_deactivated
  old_value text,
  new_value text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_audit_logs_target ON public.user_audit_logs(target_user_id, created_at DESC);
CREATE INDEX idx_user_audit_logs_tenant ON public.user_audit_logs(tenant_id, created_at DESC);

ALTER TABLE public.user_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit logs"
ON public.user_audit_logs FOR SELECT
USING (public.is_admin(auth.uid()) OR public.is_platform_admin(auth.uid()));

-- Trigger for user_roles
CREATE OR REPLACE FUNCTION public.log_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_audit_logs (target_user_id, performed_by, action, new_value)
    VALUES (NEW.user_id, auth.uid(), 'role_assigned', NEW.role::text);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      INSERT INTO public.user_audit_logs (target_user_id, performed_by, action, old_value, new_value)
      VALUES (NEW.user_id, auth.uid(), 'role_changed', OLD.role::text, NEW.role::text);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.user_audit_logs (target_user_id, performed_by, action, old_value)
    VALUES (OLD.user_id, auth.uid(), 'role_removed', OLD.role::text);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_user_role_change ON public.user_roles;
CREATE TRIGGER trg_log_user_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_user_role_change();

-- Trigger for profile activation
CREATE OR REPLACE FUNCTION public.log_profile_active_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.active IS DISTINCT FROM NEW.active THEN
    INSERT INTO public.user_audit_logs (target_user_id, performed_by, action, old_value, new_value)
    VALUES (
      NEW.user_id,
      auth.uid(),
      CASE WHEN NEW.active THEN 'user_activated' ELSE 'user_deactivated' END,
      OLD.active::text,
      NEW.active::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_profile_active_change ON public.profiles;
CREATE TRIGGER trg_log_profile_active_change
AFTER UPDATE OF active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_profile_active_change();

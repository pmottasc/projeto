
-- 1) Remove supervisor write privileges on user_roles
DROP POLICY IF EXISTS "Supervisor insert non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Supervisor update non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Supervisor delete non-admin roles" ON public.user_roles;

-- 2) Tighten profiles UPDATE: only self, app-role admin, or platform admin
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS profiles_update_owner_or_tenant_admin ON public.profiles;

CREATE POLICY profiles_update_self_or_admin
ON public.profiles
FOR UPDATE
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR public.is_platform_admin(auth.uid())
)
WITH CHECK (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR public.is_platform_admin(auth.uid())
);

-- 3) Tighten profiles DELETE: only admin or platform admin
DROP POLICY IF EXISTS profiles_delete_platform_admin ON public.profiles;
CREATE POLICY profiles_delete_admin
ON public.profiles
FOR DELETE
USING (
  public.is_admin(auth.uid())
  OR public.is_platform_admin(auth.uid())
);

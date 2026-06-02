DROP POLICY IF EXISTS tm_select_self ON public.tenant_members;

CREATE POLICY tm_select_same_tenant
ON public.tenant_members
FOR SELECT
USING (
  user_belongs_to_tenant(auth.uid(), tenant_id)
  OR is_platform_admin(auth.uid())
);
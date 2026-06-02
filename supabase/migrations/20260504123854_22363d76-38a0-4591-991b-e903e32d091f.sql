DROP POLICY IF EXISTS ta_tenant_delete ON public.ticket_attachments;

CREATE POLICY ta_tenant_delete ON public.ticket_attachments
FOR DELETE
TO authenticated
USING (
  (tenant_id IN (SELECT current_user_tenant_ids()))
  AND (user_is_tenant_admin(auth.uid(), tenant_id) OR user_id = auth.uid())
);
CREATE POLICY "wam_update" ON public.wa_messages FOR UPDATE
USING (
  tenant_id IN (SELECT current_user_tenant_ids())
  AND EXISTS (
    SELECT 1 FROM wa_conversations c
    WHERE c.id = wa_messages.conversation_id
      AND (
        user_is_tenant_admin(auth.uid(), c.tenant_id)
        OR is_admin_or_supervisor(auth.uid())
        OR c.assignee_id = auth.uid()
        OR (c.department_id IS NOT NULL AND c.department_id = current_user_department_id())
      )
  )
)
WITH CHECK (
  tenant_id IN (SELECT current_user_tenant_ids())
);

-- 1) PROFILES
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;

CREATE POLICY "profiles_select_same_tenant"
ON public.profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tenant_members tm_self
    JOIN public.tenant_members tm_target ON tm_target.tenant_id = tm_self.tenant_id
    WHERE tm_self.user_id = auth.uid() AND tm_target.user_id = profiles.user_id
  )
);

CREATE POLICY "profiles_update_owner_or_tenant_admin"
ON public.profiles FOR UPDATE TO authenticated
USING (
  user_id = auth.uid() OR public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tenant_members tm_self
    JOIN public.tenant_members tm_target ON tm_target.tenant_id = tm_self.tenant_id
    WHERE tm_self.user_id = auth.uid() AND tm_target.user_id = profiles.user_id
      AND tm_self.role IN ('owner','admin')
  )
)
WITH CHECK (
  user_id = auth.uid() OR public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tenant_members tm_self
    JOIN public.tenant_members tm_target ON tm_target.tenant_id = tm_self.tenant_id
    WHERE tm_self.user_id = auth.uid() AND tm_target.user_id = profiles.user_id
      AND tm_self.role IN ('owner','admin')
  )
);

CREATE POLICY "profiles_delete_platform_admin"
ON public.profiles FOR DELETE TO authenticated
USING (public.is_platform_admin(auth.uid()));

-- 2) search_path
ALTER FUNCTION public.next_billing_date(date, integer)  SET search_path = public;
ALTER FUNCTION public.tickets_set_resolved_at()         SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()        SET search_path = public;
ALTER FUNCTION public.apply_ticket_sla()                SET search_path = public;
ALTER FUNCTION public.chatbot_flows_validate_mode()     SET search_path = public;
ALTER FUNCTION public.chat_bump_conv_on_message()       SET search_path = public;
ALTER FUNCTION public.map_ticket_status_to_task(text)   SET search_path = public;
ALTER FUNCTION public.map_ticket_urgency_to_task(text)  SET search_path = public;

-- 3) Revogar EXECUTE de funções internas/triggers
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_tenant_features()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_tenant_billing()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tickets_sync_task()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tickets_set_resolved_at()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ticket_sla()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chatbot_flows_validate_mode()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_bump_conv_on_message()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_notify_participants()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_for_tenant(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_overdue_invoices(integer)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_tenant_quota(uuid, text, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_invoice_paid(uuid, text, text)        FROM PUBLIC, anon;

-- Helper functions usadas em policies: revogar só de anon
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid)                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_supervisor(uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_ti(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_tenant_ids()             FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_belongs_to_tenant(uuid, uuid)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_is_tenant_admin(uuid, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_chat_participant(uuid, uuid)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_department_id()          FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_billing_date(date, integer)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.map_ticket_status_to_task(text)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.map_ticket_urgency_to_task(text)      FROM anon;

-- 4) Storage: remover policies SELECT amplamente abertas
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND cmd='SELECT'
      AND policyname IN (
        'Public read avatars','Public read ticket-attachments',
        'Public read kb-media','Public read chat-attachments',
        'Public read chat-stickers','Public read tenant-logos',
        'Public Access','Public access','Allow public read'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

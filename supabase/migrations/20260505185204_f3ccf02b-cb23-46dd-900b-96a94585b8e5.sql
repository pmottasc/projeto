
-- Helper functions: revogar de PUBLIC, manter authenticated
DO $$
DECLARE
  fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'has_role(uuid, app_role)',
    'is_admin(uuid)',
    'is_admin_or_supervisor(uuid)',
    'is_admin_or_ti(uuid)',
    'is_platform_admin(uuid)',
    'current_user_tenant_ids()',
    'user_belongs_to_tenant(uuid, uuid)',
    'user_is_tenant_admin(uuid, uuid)',
    'is_chat_participant(uuid, uuid)',
    'current_user_department_id()',
    'next_billing_date(date, integer)',
    'map_ticket_status_to_task(text)',
    'map_ticket_urgency_to_task(text)',
    'mark_invoice_paid(uuid, text, text)'
  ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;

-- Storage: remover policies de listagem pública (downloads continuam por URL pública)
DROP POLICY IF EXISTS "Anyone can view kb media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant logos public read" ON storage.objects;
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
DROP POLICY IF EXISTS "chat att public read" ON storage.objects;
DROP POLICY IF EXISTS "stickers public read" ON storage.objects;

-- Authenticated SELECT por bucket (permite app listar arquivos quando logado)
CREATE POLICY "auth_read_kb_media"        ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'kb-media');
CREATE POLICY "auth_read_tenant_logos"    ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'tenant-logos');
CREATE POLICY "auth_read_avatars"         ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "auth_read_chat_stickers"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-stickers');
-- chat-attachments e ticket-attachments já têm "Authenticated users can view attachments"

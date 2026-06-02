
-- ============ AVATAR no profile ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- ============ TIPOS ============
DO $$ BEGIN
  CREATE TYPE public.chat_conversation_type AS ENUM ('dm','group');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_message_type AS ENUM ('text','image','video','file');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_presence_status AS ENUM ('online','offline','busy','away','invisible');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ CONVERSATIONS ============
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type public.chat_conversation_type NOT NULL DEFAULT 'dm',
  name text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  type public.chat_message_type NOT NULL DEFAULT 'text',
  content text NOT NULL DEFAULT '',
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  attachment_mime text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_presence (
  user_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  status public.chat_presence_status NOT NULL DEFAULT 'offline',
  manual_status public.chat_presence_status,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_msgs_conv ON public.chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_parts_user ON public.chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_parts_conv ON public.chat_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_tenant ON public.chat_conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_presence_tenant ON public.chat_presence(tenant_id);

-- ============ HELPER (security definer) ============
CREATE OR REPLACE FUNCTION public.is_chat_participant(_user_id uuid, _conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_participants WHERE user_id = _user_id AND conversation_id = _conversation_id)
$$;

-- ============ TRIGGER updated_at conversations ============
DROP TRIGGER IF EXISTS trg_chat_conv_upd ON public.chat_conversations;
CREATE TRIGGER trg_chat_conv_upd BEFORE UPDATE ON public.chat_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- bump conversation updated_at on new message
CREATE OR REPLACE FUNCTION public.chat_bump_conv_on_message()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.chat_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_chat_bump_conv ON public.chat_messages;
CREATE TRIGGER trg_chat_bump_conv AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.chat_bump_conv_on_message();

-- ============ RLS ============
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_presence ENABLE ROW LEVEL SECURITY;

-- conversations
CREATE POLICY "chat_conv_select" ON public.chat_conversations FOR SELECT TO authenticated
USING (public.is_chat_participant(auth.uid(), id) OR (created_by = auth.uid()));

CREATE POLICY "chat_conv_insert" ON public.chat_conversations FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND created_by = auth.uid());

CREATE POLICY "chat_conv_update" ON public.chat_conversations FOR UPDATE TO authenticated
USING (public.is_chat_participant(auth.uid(), id))
WITH CHECK (public.is_chat_participant(auth.uid(), id));

CREATE POLICY "chat_conv_delete" ON public.chat_conversations FOR DELETE TO authenticated
USING (created_by = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id));

-- participants
CREATE POLICY "chat_part_select" ON public.chat_participants FOR SELECT TO authenticated
USING (public.is_chat_participant(auth.uid(), conversation_id));

CREATE POLICY "chat_part_insert" ON public.chat_participants FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (SELECT current_user_tenant_ids())
  AND (
    -- creator can add anyone from same tenant
    EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = conversation_id AND c.created_by = auth.uid())
    OR public.is_chat_participant(auth.uid(), conversation_id)
    OR user_id = auth.uid()
  )
);

CREATE POLICY "chat_part_update" ON public.chat_participants FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.is_chat_participant(auth.uid(), conversation_id));

CREATE POLICY "chat_part_delete" ON public.chat_participants FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.is_chat_participant(auth.uid(), conversation_id));

-- messages
CREATE POLICY "chat_msg_select" ON public.chat_messages FOR SELECT TO authenticated
USING (public.is_chat_participant(auth.uid(), conversation_id));

CREATE POLICY "chat_msg_insert" ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND tenant_id IN (SELECT current_user_tenant_ids())
  AND public.is_chat_participant(auth.uid(), conversation_id)
);

CREATE POLICY "chat_msg_update" ON public.chat_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

CREATE POLICY "chat_msg_delete" ON public.chat_messages FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id));

-- presence
CREATE POLICY "chat_pres_select" ON public.chat_presence FOR SELECT TO authenticated
USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY "chat_pres_upsert_ins" ON public.chat_presence FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY "chat_pres_upsert_upd" ON public.chat_presence FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ REALTIME ============
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_participants REPLICA IDENTITY FULL;
ALTER TABLE public.chat_presence REPLICA IDENTITY FULL;
ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_participants;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_presence;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ STORAGE BUCKETS ============
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- avatars policies
CREATE POLICY "avatars public read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "avatars user upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars user update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars user delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- chat-attachments policies (public read, authenticated upload in own folder)
CREATE POLICY "chat att public read" ON storage.objects FOR SELECT USING (bucket_id = 'chat-attachments');
CREATE POLICY "chat att user upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "chat att user delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

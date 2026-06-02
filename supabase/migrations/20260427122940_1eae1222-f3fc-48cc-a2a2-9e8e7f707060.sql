
ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-stickers', 'chat-stickers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "stickers public read" ON storage.objects FOR SELECT
USING (bucket_id = 'chat-stickers');

CREATE POLICY "stickers user upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-stickers' AND auth.uid()::text = (storage.foldername(name))[1]);

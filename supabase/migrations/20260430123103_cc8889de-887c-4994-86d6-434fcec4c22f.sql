ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS media_name text NOT NULL DEFAULT '';
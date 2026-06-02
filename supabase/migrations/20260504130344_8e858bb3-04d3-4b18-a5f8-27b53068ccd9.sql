ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_chat_parts_hidden ON public.chat_participants(user_id, hidden_at);
ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS bot_processed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_unique_external
  ON public.wa_messages(tenant_id, external_id)
  WHERE external_id <> '';
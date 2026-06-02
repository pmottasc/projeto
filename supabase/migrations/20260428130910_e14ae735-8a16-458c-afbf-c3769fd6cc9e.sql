ALTER TABLE public.wa_conversations
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_wa_conv_archived
ON public.wa_conversations (tenant_id, archived_at);
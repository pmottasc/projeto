
-- Add 'evolution' as a valid provider kind
ALTER TYPE wa_provider_kind ADD VALUE IF NOT EXISTS 'evolution';

-- Add evolution-specific columns to wa_provider_config
ALTER TABLE public.wa_provider_config
  ADD COLUMN IF NOT EXISTS evolution_instance_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_qr_at timestamp with time zone NULL;

ALTER TABLE public.wa_provider_config
  ADD COLUMN IF NOT EXISTS evolution_api_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evolution_api_key text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.wa_provider_config.evolution_api_url IS 'URL base da Evolution API por tenant. Vazio = usa env global EVOLUTION_API_URL.';
COMMENT ON COLUMN public.wa_provider_config.evolution_api_key IS 'API key da Evolution por tenant. Vazio = usa env global EVOLUTION_API_KEY.';
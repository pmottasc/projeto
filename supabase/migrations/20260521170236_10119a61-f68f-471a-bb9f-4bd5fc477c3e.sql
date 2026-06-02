ALTER TABLE public.chatbot_flows
  ADD COLUMN IF NOT EXISTS agent_api_provider text NOT NULL DEFAULT 'lovable',
  ADD COLUMN IF NOT EXISTS agent_api_key text,
  ADD COLUMN IF NOT EXISTS agent_api_base_url text;
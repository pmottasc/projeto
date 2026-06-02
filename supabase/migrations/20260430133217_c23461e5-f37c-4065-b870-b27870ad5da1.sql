ALTER TABLE public.chatbot_flows
  ADD COLUMN IF NOT EXISTS agent_max_tokens integer NOT NULL DEFAULT 600;

ALTER TABLE public.chatbot_flows
  ALTER COLUMN agent_model SET DEFAULT 'google/gemini-2.5-flash-lite';

UPDATE public.chatbot_flows
   SET agent_model = 'google/gemini-2.5-flash-lite'
 WHERE agent_model IN ('google/gemini-3-flash-preview', '', 'google/gemini-2.5-flash');

COMMENT ON COLUMN public.chatbot_flows.agent_max_tokens IS 'Tamanho máximo (em tokens) de cada resposta do agente IA. Reduz custo e impede respostas longas demais.';
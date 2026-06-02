ALTER TABLE public.chatbot_flows
  ALTER COLUMN agent_tools SET DEFAULT ARRAY['create_ticket','lookup_ticket','handoff','collect_contact_info','remember','search_kb','request_document']::text[];

UPDATE public.chatbot_flows
SET agent_tools = array_append(agent_tools, 'request_document'),
    updated_at = now()
WHERE mode = 'agent'
  AND NOT ('request_document' = ANY(agent_tools));
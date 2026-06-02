-- Add list_documents to default agent_tools and to existing flows that have request_document
ALTER TABLE public.chatbot_flows
  ALTER COLUMN agent_tools SET DEFAULT ARRAY['create_ticket','lookup_ticket','handoff','collect_contact_info','remember','search_kb','list_documents','request_document'];

UPDATE public.chatbot_flows
SET agent_tools = (
  SELECT ARRAY(SELECT DISTINCT unnest(agent_tools || ARRAY['list_documents']))
)
WHERE 'request_document' = ANY(agent_tools)
  AND NOT ('list_documents' = ANY(agent_tools));
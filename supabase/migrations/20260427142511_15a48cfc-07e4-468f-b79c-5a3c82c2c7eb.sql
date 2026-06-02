-- ChatBot flow types
CREATE TYPE public.chatbot_node_kind AS ENUM (
  'start', 'message', 'question', 'condition', 'action', 'handoff', 'end'
);

CREATE TYPE public.chatbot_trigger_kind AS ENUM (
  'any_message', 'keyword', 'first_contact', 'manual'
);

-- Flows
CREATE TABLE public.chatbot_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_kind chatbot_trigger_kind NOT NULL DEFAULT 'any_message',
  trigger_keywords TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chatbot_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbf_member_select ON public.chatbot_flows
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY cbf_admin_manage ON public.chatbot_flows
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER cbf_updated_at BEFORE UPDATE ON public.chatbot_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nodes
CREATE TABLE public.chatbot_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  kind chatbot_node_kind NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}',
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chatbot_nodes_flow ON public.chatbot_nodes(flow_id);
ALTER TABLE public.chatbot_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbn_member_select ON public.chatbot_nodes
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY cbn_admin_manage ON public.chatbot_nodes
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER cbn_updated_at BEFORE UPDATE ON public.chatbot_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Edges (connections)
CREATE TABLE public.chatbot_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.chatbot_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.chatbot_nodes(id) ON DELETE CASCADE,
  source_handle TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chatbot_edges_flow ON public.chatbot_edges(flow_id);
ALTER TABLE public.chatbot_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbe_member_select ON public.chatbot_edges
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY cbe_admin_manage ON public.chatbot_edges
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

-- Sessions (runtime state)
CREATE TABLE public.chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  current_node_id UUID,
  variables JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chatbot_sessions_conv ON public.chatbot_sessions(conversation_id);
ALTER TABLE public.chatbot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbs_member_select ON public.chatbot_sessions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY cbs_admin_manage ON public.chatbot_sessions
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER cbses_updated_at BEFORE UPDATE ON public.chatbot_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
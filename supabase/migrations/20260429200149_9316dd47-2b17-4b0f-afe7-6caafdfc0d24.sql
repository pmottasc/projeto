-- 1) Add agent fields to chatbot_flows
ALTER TABLE public.chatbot_flows
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS agent_persona text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  ADD COLUMN IF NOT EXISTS agent_tools text[] NOT NULL DEFAULT ARRAY['create_ticket','lookup_ticket','handoff','collect_contact_info','remember','search_kb']::text[],
  ADD COLUMN IF NOT EXISTS agent_handoff_keywords text[] NOT NULL DEFAULT ARRAY['humano','atendente','pessoa','operador']::text[];

-- Constrain mode values via trigger (avoid CHECK + future enum changes)
CREATE OR REPLACE FUNCTION public.chatbot_flows_validate_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mode NOT IN ('flow','agent') THEN
    RAISE EXCEPTION 'invalid mode %, allowed: flow|agent', NEW.mode;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cbf_validate_mode ON public.chatbot_flows;
CREATE TRIGGER trg_cbf_validate_mode
BEFORE INSERT OR UPDATE ON public.chatbot_flows
FOR EACH ROW EXECUTE FUNCTION public.chatbot_flows_validate_mode();

-- 2) Long-term memory per contact
CREATE TABLE IF NOT EXISTS public.chatbot_agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_cam_tenant_contact ON public.chatbot_agent_memory (tenant_id, contact_id);

ALTER TABLE public.chatbot_agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cam_select ON public.chatbot_agent_memory;
CREATE POLICY cam_select ON public.chatbot_agent_memory
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

DROP POLICY IF EXISTS cam_admin_manage ON public.chatbot_agent_memory;
CREATE POLICY cam_admin_manage ON public.chatbot_agent_memory
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

DROP TRIGGER IF EXISTS trg_cam_updated ON public.chatbot_agent_memory;
CREATE TRIGGER trg_cam_updated
BEFORE UPDATE ON public.chatbot_agent_memory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
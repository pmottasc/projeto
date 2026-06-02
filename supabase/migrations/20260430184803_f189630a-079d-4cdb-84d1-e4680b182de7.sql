
ALTER TABLE public.chatbot_flows
  ADD COLUMN IF NOT EXISTS inactivity_timeout_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS inactivity_handoff_department_id uuid NULL REFERENCES public.departments(id) ON DELETE SET NULL;

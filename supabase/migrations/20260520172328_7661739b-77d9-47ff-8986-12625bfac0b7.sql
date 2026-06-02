
CREATE TABLE public.user_agenda_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  title text NOT NULL,
  description text,
  location text,
  color text DEFAULT '#3b82f6',
  all_day boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_agenda_events_user_start ON public.user_agenda_events(user_id, start_at);

ALTER TABLE public.user_agenda_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own agenda" ON public.user_agenda_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own agenda" ON public.user_agenda_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own agenda" ON public.user_agenda_events
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own agenda" ON public.user_agenda_events
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_agenda_events_updated_at
  BEFORE UPDATE ON public.user_agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

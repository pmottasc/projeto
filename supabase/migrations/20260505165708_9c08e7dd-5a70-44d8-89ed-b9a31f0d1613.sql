ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_ticket_id ON public.tasks(ticket_id);
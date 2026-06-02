
-- Tabela para controle de deduplicação de e-mails processados
CREATE TABLE public.processed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL UNIQUE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  sender_email text NOT NULL,
  subject text NOT NULL,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'success',
  error_message text DEFAULT ''
);

-- RLS: somente admin/ti podem ver logs
ALTER TABLE public.processed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/TI can view processed emails"
  ON public.processed_emails FOR SELECT TO authenticated
  USING (is_admin_or_ti(auth.uid()));

CREATE POLICY "Service can insert processed emails"
  ON public.processed_emails FOR INSERT TO authenticated
  WITH CHECK (true);

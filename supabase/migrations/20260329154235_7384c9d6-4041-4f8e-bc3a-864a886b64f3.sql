
-- Create storage bucket for ticket attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('ticket-attachments', 'ticket-attachments', true);

-- Create ticket_attachments table
CREATE TABLE public.ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;

-- Users can view attachments on their own tickets or if admin/ti
CREATE POLICY "Users can view attachments" ON public.ticket_attachments
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM tickets WHERE tickets.id = ticket_attachments.ticket_id AND tickets.created_by = auth.uid())
  OR is_admin_or_ti(auth.uid())
);

-- Authenticated users can insert attachments
CREATE POLICY "Users can add attachments" ON public.ticket_attachments
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Storage policies for ticket-attachments bucket
CREATE POLICY "Authenticated users can upload attachments" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ticket-attachments');

CREATE POLICY "Authenticated users can view attachments" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'ticket-attachments');

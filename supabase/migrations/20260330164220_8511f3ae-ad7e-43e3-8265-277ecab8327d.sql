
-- Fix: restrict insert to admin/ti only
DROP POLICY "Service can insert processed emails" ON public.processed_emails;
CREATE POLICY "Admin/TI can insert processed emails"
  ON public.processed_emails FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_ti(auth.uid()));


-- Fix: restrict notification inserts to admin/ti users or system
DROP POLICY "System can insert notifications" ON public.notifications;
CREATE POLICY "Admins can insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_ti(auth.uid()) OR auth.uid() = user_id);

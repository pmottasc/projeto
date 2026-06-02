CREATE POLICY "Admins can delete tickets"
ON public.tickets
FOR DELETE
TO authenticated
USING (public.is_admin_or_ti(auth.uid()));

CREATE POLICY "Admins can delete ticket comments"
ON public.ticket_comments
FOR DELETE
TO authenticated
USING (public.is_admin_or_ti(auth.uid()));

CREATE POLICY "Admins can delete ticket history"
ON public.ticket_history
FOR DELETE
TO authenticated
USING (public.is_admin_or_ti(auth.uid()));

CREATE POLICY "Admins can delete ticket attachments"
ON public.ticket_attachments
FOR DELETE
TO authenticated
USING (public.is_admin_or_ti(auth.uid()));

CREATE POLICY "Users can delete own notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
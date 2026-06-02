
-- Drop the existing insert policy and create a new one that allows admin/TI to create tickets on behalf of other users
DROP POLICY IF EXISTS "Users can create tickets" ON public.tickets;

CREATE POLICY "Users can create tickets"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by OR is_admin_or_ti(auth.uid())
);

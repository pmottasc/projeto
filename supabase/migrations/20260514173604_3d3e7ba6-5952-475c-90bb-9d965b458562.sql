-- Mapeia status para um rótulo legível
CREATE OR REPLACE FUNCTION public.ticket_status_label(_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _status
    WHEN 'aberto' THEN 'Aberto'
    WHEN 'em_andamento' THEN 'Em andamento'
    WHEN 'em_atendimento' THEN 'Em atendimento'
    WHEN 'aguardando' THEN 'Aguardando'
    WHEN 'resolvido' THEN 'Resolvido'
    WHEN 'finalizado' THEN 'Finalizado'
    WHEN 'fechado' THEN 'Fechado'
    WHEN 'cancelado' THEN 'Cancelado'
    ELSE _status
  END
$$;

-- Trigger: notifica usuários relevantes quando o status muda
CREATE OR REPLACE FUNCTION public.tickets_notify_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_msg text;
  v_recipients uuid[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_msg := 'Chamado #' || NEW.number || ' "' || NEW.title || '" mudou de '
    || public.ticket_status_label(OLD.status::text)
    || ' para '
    || public.ticket_status_label(NEW.status::text);

  v_recipients := ARRAY(
    SELECT DISTINCT u FROM unnest(ARRAY[NEW.created_by, NEW.assignee_id, NEW.requested_for]) AS u
    WHERE u IS NOT NULL AND (v_actor IS NULL OR u <> v_actor)
  );

  FOREACH v_recipient IN ARRAY v_recipients LOOP
    INSERT INTO public.notifications (user_id, tenant_id, ticket_id, message, read)
    VALUES (v_recipient, NEW.tenant_id, NEW.id, v_msg, false);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_notify_status_change ON public.tickets;
CREATE TRIGGER trg_tickets_notify_status_change
AFTER UPDATE OF status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.tickets_notify_status_change();

-- Realtime para notifications
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.map_task_status_to_ticket(_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _status
    WHEN 'a_fazer' THEN 'aberto'
    WHEN 'em_andamento' THEN 'em_andamento'
    WHEN 'em_revisao' THEN 'aguardando'
    WHEN 'concluido' THEN 'resolvido'
    ELSE 'aberto'
  END
$$;

CREATE OR REPLACE FUNCTION public.tasks_sync_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_ticket_status text;
BEGIN
  IF NEW.ticket_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  v_new_ticket_status := public.map_task_status_to_ticket(NEW.status::text);
  UPDATE public.tickets
    SET status = v_new_ticket_status::ticket_status,
        updated_at = now()
    WHERE id = NEW.ticket_id
      AND status::text <> v_new_ticket_status;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_sync_ticket ON public.tasks;
CREATE TRIGGER trg_tasks_sync_ticket
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_ticket();
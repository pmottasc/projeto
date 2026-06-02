
CREATE OR REPLACE FUNCTION public.map_ticket_status_to_task(_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _status
    WHEN 'aberto' THEN 'a_fazer'
    WHEN 'em_andamento' THEN 'em_andamento'
    WHEN 'em_atendimento' THEN 'em_andamento'
    WHEN 'aguardando' THEN 'em_revisao'
    WHEN 'resolvido' THEN 'concluido'
    WHEN 'fechado' THEN 'concluido'
    WHEN 'finalizado' THEN 'concluido'
    WHEN 'cancelado' THEN 'concluido'
    ELSE 'a_fazer'
  END
$$;

CREATE OR REPLACE FUNCTION public.map_ticket_urgency_to_task(_urg text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _urg
    WHEN 'baixa' THEN 'baixa'
    WHEN 'media' THEN 'media'
    WHEN 'alta' THEN 'alta'
    WHEN 'critica' THEN 'urgente'
    WHEN 'urgente' THEN 'urgente'
    ELSE 'media'
  END
$$;

CREATE OR REPLACE FUNCTION public.tickets_sync_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_id uuid;
  v_new_status text;
  v_new_prio text;
BEGIN
  v_new_status := public.map_ticket_status_to_task(NEW.status::text);
  v_new_prio := public.map_ticket_urgency_to_task(NEW.urgency::text);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.tasks (
      tenant_id, titulo, descricao, status, prioridade,
      responsavel_id, criado_por, ticket_id, position
    ) VALUES (
      NEW.tenant_id,
      '#' || NEW.number || ' - ' || NEW.title,
      COALESCE(NEW.description, ''),
      v_new_status,
      v_new_prio,
      NEW.assignee_id,
      NEW.created_by,
      NEW.id,
      (SELECT COUNT(*) FROM public.tasks WHERE tenant_id = NEW.tenant_id AND status = v_new_status)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id INTO v_task_id FROM public.tasks WHERE ticket_id = NEW.id LIMIT 1;
    IF v_task_id IS NULL THEN
      INSERT INTO public.tasks (
        tenant_id, titulo, descricao, status, prioridade,
        responsavel_id, criado_por, ticket_id, position
      ) VALUES (
        NEW.tenant_id,
        '#' || NEW.number || ' - ' || NEW.title,
        COALESCE(NEW.description, ''),
        v_new_status,
        v_new_prio,
        NEW.assignee_id,
        NEW.created_by,
        NEW.id,
        (SELECT COUNT(*) FROM public.tasks WHERE tenant_id = NEW.tenant_id AND status = v_new_status)
      );
    ELSE
      UPDATE public.tasks
        SET status = v_new_status,
            prioridade = v_new_prio,
            titulo = '#' || NEW.number || ' - ' || NEW.title,
            descricao = COALESCE(NEW.description, ''),
            responsavel_id = COALESCE(NEW.assignee_id, responsavel_id),
            last_status_changed_at = CASE WHEN status <> v_new_status THEN now() ELSE last_status_changed_at END,
            updated_at = now()
        WHERE id = v_task_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_sync_task_ins ON public.tickets;
CREATE TRIGGER trg_tickets_sync_task_ins
AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.tickets_sync_task();

DROP TRIGGER IF EXISTS trg_tickets_sync_task_upd ON public.tickets;
CREATE TRIGGER trg_tickets_sync_task_upd
AFTER UPDATE OF status, title, description, urgency, assignee_id ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.tickets_sync_task();

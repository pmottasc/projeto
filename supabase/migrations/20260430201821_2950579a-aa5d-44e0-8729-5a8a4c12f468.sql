CREATE OR REPLACE FUNCTION public.chat_notify_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Notificações do chat interno são tratadas no app (badge/realtime).
  -- Não inserimos em public.notifications para não poluir a aba de notificações dos chamados.
  RETURN NEW;
END;
$function$;

-- Limpa notificações antigas que vieram do chat (prefixo 💬) sem ticket associado
DELETE FROM public.notifications
 WHERE ticket_id IS NULL
   AND message LIKE '💬%';
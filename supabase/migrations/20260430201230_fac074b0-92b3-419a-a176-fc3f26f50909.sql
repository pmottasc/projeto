
CREATE OR REPLACE FUNCTION public.chat_notify_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_preview text;
  v_type text := NEW.type::text;
BEGIN
  SELECT COALESCE(name, username, 'Alguém')
    INTO v_sender_name
    FROM public.profiles
   WHERE user_id = NEW.sender_id
   LIMIT 1;

  v_preview := CASE v_type
    WHEN 'text'  THEN left(COALESCE(NEW.content, ''), 80)
    WHEN 'image' THEN '📷 Imagem'
    WHEN 'video' THEN '🎥 Vídeo'
    WHEN 'file'  THEN '📎 Arquivo'
    ELSE 'Nova mensagem'
  END;

  INSERT INTO public.notifications (user_id, tenant_id, message)
  SELECT cp.user_id,
         NEW.tenant_id,
         '💬 ' || COALESCE(v_sender_name, 'Alguém') || ': ' || v_preview
    FROM public.chat_participants cp
   WHERE cp.conversation_id = NEW.conversation_id
     AND cp.user_id <> NEW.sender_id
     AND cp.archived_at IS NULL;

  RETURN NEW;
END;
$$;

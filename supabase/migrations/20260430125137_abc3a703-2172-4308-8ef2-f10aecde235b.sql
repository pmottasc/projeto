-- Helper: retorna o department_id do usuário atual (security definer p/ evitar recursão)
CREATE OR REPLACE FUNCTION public.current_user_department_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- =========================
-- wa_conversations: visibilidade por setor
-- =========================
DROP POLICY IF EXISTS waconv_select ON public.wa_conversations;
CREATE POLICY waconv_select ON public.wa_conversations
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (
    -- Admin do tenant OU admin/supervisor da plataforma: vê tudo
    public.user_is_tenant_admin(auth.uid(), tenant_id)
    OR public.is_admin_or_supervisor(auth.uid())
    -- Atribuída ao próprio usuário
    OR assignee_id = auth.uid()
    -- Transferida para o setor do usuário (visível para a fila do setor)
    OR (
      department_id IS NOT NULL
      AND department_id = public.current_user_department_id()
    )
  )
);

DROP POLICY IF EXISTS waconv_update ON public.wa_conversations;
CREATE POLICY waconv_update ON public.wa_conversations
FOR UPDATE TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (
    public.user_is_tenant_admin(auth.uid(), tenant_id)
    OR public.is_admin_or_supervisor(auth.uid())
    OR assignee_id = auth.uid()
    OR (
      department_id IS NOT NULL
      AND department_id = public.current_user_department_id()
    )
  )
)
WITH CHECK (
  tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- =========================
-- wa_messages: visibilidade segue a da conversa
-- =========================
DROP POLICY IF EXISTS wam_select ON public.wa_messages;
CREATE POLICY wam_select ON public.wa_messages
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND EXISTS (
    SELECT 1 FROM public.wa_conversations c
    WHERE c.id = wa_messages.conversation_id
      AND (
        public.user_is_tenant_admin(auth.uid(), c.tenant_id)
        OR public.is_admin_or_supervisor(auth.uid())
        OR c.assignee_id = auth.uid()
        OR (
          c.department_id IS NOT NULL
          AND c.department_id = public.current_user_department_id()
        )
      )
  )
);
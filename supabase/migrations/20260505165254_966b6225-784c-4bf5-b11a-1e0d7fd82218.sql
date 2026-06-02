
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  titulo text NOT NULL,
  descricao text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'a_fazer',
  prioridade text NOT NULL DEFAULT 'media',
  responsavel_id uuid,
  criado_por uuid NOT NULL,
  data_prevista date,
  comentarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  last_status_changed_by uuid,
  last_status_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND criado_por = auth.uid()
  );

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      criado_por = auth.uid()
      OR responsavel_id = auth.uid()
      OR user_is_tenant_admin(auth.uid(), tenant_id)
      OR is_admin_or_supervisor(auth.uid())
    )
  );

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      criado_por = auth.uid()
      OR user_is_tenant_admin(auth.uid(), tenant_id)
      OR is_admin_or_supervisor(auth.uid())
    )
  );

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON public.tasks(tenant_id, status, position);

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

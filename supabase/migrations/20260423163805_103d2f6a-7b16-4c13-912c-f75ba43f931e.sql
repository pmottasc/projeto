
-- 1. Tabela de categorias por tenant
CREATE TABLE IF NOT EXISTS public.ticket_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  icon text NOT NULL DEFAULT 'folder',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ticket_categories_tenant ON public.ticket_categories(tenant_id);

ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tc_tenant_select ON public.ticket_categories;
CREATE POLICY tc_tenant_select ON public.ticket_categories
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

DROP POLICY IF EXISTS tc_tenant_admin_manage ON public.ticket_categories;
CREATE POLICY tc_tenant_admin_manage ON public.ticket_categories
  FOR ALL TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))
  WITH CHECK (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));

-- 2. Categorias padrão para tenants existentes
INSERT INTO public.ticket_categories (tenant_id, name, color, icon)
SELECT t.id, c.name, c.color, c.icon
FROM public.tenants t
CROSS JOIN (VALUES
  ('TI / Infraestrutura', '#3b82f6', 'monitor'),
  ('Sistema',             '#8b5cf6', 'app-window'),
  ('Financeiro',          '#10b981', 'banknote'),
  ('RH',                  '#f59e0b', 'users'),
  ('Outro',               '#6b7280', 'folder')
) AS c(name, color, icon)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3. Adicionar colunas em tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.ticket_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_category ON public.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON public.tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status_v2 ON public.tickets(tenant_id, status);

-- 4. Migrar status antigos -> novos (agora pode, enums já comitados)
UPDATE public.tickets SET status = 'em_atendimento'::ticket_status WHERE status::text = 'em_andamento';
UPDATE public.tickets SET status = 'fechado'::ticket_status        WHERE status::text = 'finalizado';

-- 5. Atualizar policies de tickets para incluir assignee
DROP POLICY IF EXISTS tickets_tenant_select ON public.tickets;
CREATE POLICY tickets_tenant_select ON public.tickets
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      user_is_tenant_admin(auth.uid(), tenant_id)
      OR auth.uid() = created_by
      OR auth.uid() = requested_for
      OR auth.uid() = assignee_id
    )
  );

DROP POLICY IF EXISTS tickets_tenant_update ON public.tickets;
CREATE POLICY tickets_tenant_update ON public.tickets
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (user_is_tenant_admin(auth.uid(), tenant_id) OR auth.uid() = assignee_id)
  );

-- 6. Templates de resposta
CREATE TABLE IF NOT EXISTS public.response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  category_id uuid REFERENCES public.ticket_categories(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_response_templates_tenant ON public.response_templates(tenant_id);

ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rt_tenant_select ON public.response_templates;
CREATE POLICY rt_tenant_select ON public.response_templates
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

DROP POLICY IF EXISTS rt_tenant_admin_manage ON public.response_templates;
CREATE POLICY rt_tenant_admin_manage ON public.response_templates
  FOR ALL TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))
  WITH CHECK (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));

DROP TRIGGER IF EXISTS set_response_templates_updated_at ON public.response_templates;
CREATE TRIGGER set_response_templates_updated_at
  BEFORE UPDATE ON public.response_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Templates padrão por tenant
INSERT INTO public.response_templates (tenant_id, title, content, created_by)
SELECT t.id, x.title, x.content,
       (SELECT user_id FROM public.tenant_members WHERE tenant_id = t.id AND role IN ('owner','admin') LIMIT 1)
FROM public.tenants t
CROSS JOIN (VALUES
  ('Recebido',
   'Olá {nome_solicitante}, recebemos seu chamado #{numero_chamado} e já está em análise. Em breve retornaremos.'),
  ('Em andamento',
   'Olá {nome_solicitante}, seu chamado #{numero_chamado} está em atendimento. Estamos trabalhando na solução.'),
  ('Aguardando informação',
   'Olá {nome_solicitante}, para prosseguir com o chamado #{numero_chamado} precisamos das seguintes informações: '),
  ('Resolvido',
   'Olá {nome_solicitante}, o chamado #{numero_chamado} foi resolvido. Caso ainda apresente problema, basta responder aqui.')
) AS x(title, content)
WHERE EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = t.id);

-- 8. Trigger: ao mudar status para resolvido/fechado, registrar resolved_at
CREATE OR REPLACE FUNCTION public.tickets_set_resolved_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text IN ('resolvido','fechado','finalizado')
     AND (OLD.status IS NULL OR OLD.status::text NOT IN ('resolvido','fechado','finalizado')) THEN
    NEW.resolved_at = now();
  ELSIF NEW.status::text NOT IN ('resolvido','fechado','finalizado') THEN
    NEW.resolved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_resolved_at ON public.tickets;
CREATE TRIGGER trg_tickets_resolved_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_set_resolved_at();

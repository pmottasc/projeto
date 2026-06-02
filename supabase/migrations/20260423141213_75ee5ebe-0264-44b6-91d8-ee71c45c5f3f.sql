
-- =====================================================================
-- 1. NOVOS ENUMS
-- =====================================================================
CREATE TYPE public.tenant_status AS ENUM ('active', 'suspended', 'inactive', 'trial');
CREATE TYPE public.tenant_member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- =====================================================================
-- 2. PLANS — catálogo comercial
-- =====================================================================
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0,
  max_users integer NOT NULL DEFAULT 5,
  max_conversions_per_month integer NOT NULL DEFAULT 50,
  max_storage_mb integer NOT NULL DEFAULT 1024,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

INSERT INTO public.plans (slug, name, description, price_cents, max_users, max_conversions_per_month, max_storage_mb, features) VALUES
  ('basic',        'Básico',        'Ideal para escritórios pequenos',  9900,   3,   50, 1024,  '{"ocr":false,"api":false,"custom_rules":false}'::jsonb),
  ('professional', 'Profissional',  'Para escritórios em crescimento',  19900, 10,  500, 5120,  '{"ocr":true,"api":false,"custom_rules":true}'::jsonb),
  ('enterprise',   'Empresarial',   'Sem limites, suporte prioritário', 49900, 999, 99999, 51200, '{"ocr":true,"api":true,"custom_rules":true}'::jsonb);

-- =====================================================================
-- 3. TENANTS — cada cliente vendido
-- =====================================================================
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  status public.tenant_status NOT NULL DEFAULT 'active',
  plan_id uuid REFERENCES public.plans(id),
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 4. PLATFORM_ADMINS — super admins (gestão da plataforma)
-- =====================================================================
CREATE TABLE public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 5. TENANT_MEMBERS — usuário ↔ tenant
-- =====================================================================
CREATE TABLE public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.tenant_member_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tenant_members_user ON public.tenant_members(user_id);
CREATE INDEX idx_tenant_members_tenant ON public.tenant_members(tenant_id);

-- =====================================================================
-- 6. SUBSCRIPTIONS
-- =====================================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status public.subscription_status NOT NULL DEFAULT 'active',
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 7. INVITATIONS
-- =====================================================================
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.tenant_member_role NOT NULL DEFAULT 'member',
  status public.invitation_status NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 8. AUDIT_LOGS
-- =====================================================================
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_tenant ON public.audit_logs(tenant_id, created_at DESC);

-- =====================================================================
-- 9. CONVERSION_HISTORY (PDF → OFX)
-- =====================================================================
CREATE TABLE public.conversion_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_filename text NOT NULL,
  bank_detected text NOT NULL DEFAULT '',
  transaction_count integer NOT NULL DEFAULT 0,
  total_credits numeric(14,2) NOT NULL DEFAULT 0,
  total_debits numeric(14,2) NOT NULL DEFAULT 0,
  reconciliation_ok boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_conversion_tenant ON public.conversion_history(tenant_id, created_at DESC);

-- =====================================================================
-- 10. ADICIONAR tenant_id às tabelas existentes
-- =====================================================================
ALTER TABLE public.tickets             ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ticket_comments     ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ticket_attachments  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ticket_history      ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kb_articles         ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kb_categories       ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kb_article_steps    ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ramais              ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.passwords_vault     ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.notifications       ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.processed_emails    ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- =====================================================================
-- 11. FUNÇÕES UTILITÁRIAS (security definer, sem recursão)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.user_belongs_to_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = _user_id AND tenant_id = _tenant_id)
$$;

CREATE OR REPLACE FUNCTION public.user_is_tenant_admin(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND role IN ('owner','admin')
  )
$$;

-- =====================================================================
-- 12. MIGRAÇÃO DE DADOS — criar tenant Tell e vincular tudo
-- =====================================================================
DO $$
DECLARE
  v_tenant_id uuid;
  v_plan_id uuid;
  v_admin_user_id uuid;
BEGIN
  SELECT id INTO v_plan_id FROM public.plans WHERE slug = 'enterprise';

  INSERT INTO public.tenants (slug, name, status, plan_id, contact_email)
  VALUES ('tell', 'Tell Contabilidade', 'active', v_plan_id, '')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.subscriptions (tenant_id, plan_id, status)
  VALUES (v_tenant_id, v_plan_id, 'active');

  -- Vincular TODOS os usuários atuais ao tenant Tell
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  SELECT
    v_tenant_id,
    p.user_id,
    CASE WHEN ur.role IN ('admin','ti') THEN 'owner'::public.tenant_member_role
         ELSE 'member'::public.tenant_member_role END
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id;

  -- Promover admins/ti a platform_admins
  INSERT INTO public.platform_admins (user_id)
  SELECT DISTINCT ur.user_id FROM public.user_roles ur
  WHERE ur.role IN ('admin','ti')
  ON CONFLICT (user_id) DO NOTHING;

  -- Atribuir dados existentes ao tenant Tell
  UPDATE public.tickets             SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.ticket_comments     SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.ticket_attachments  SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.ticket_history      SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.kb_articles         SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.kb_categories       SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.kb_article_steps    SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.ramais              SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.passwords_vault     SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.notifications       SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.processed_emails    SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
END $$;

-- Tornar tenant_id NOT NULL após backfill
ALTER TABLE public.tickets             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ticket_comments     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ticket_attachments  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ticket_history      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kb_articles         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kb_categories       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kb_article_steps    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ramais              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.passwords_vault     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.notifications       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.processed_emails    ALTER COLUMN tenant_id SET NOT NULL;

-- =====================================================================
-- 13. RLS POLICIES — banco central
-- =====================================================================
-- PLANS: leitura pública autenticada, escrita só super admin
CREATE POLICY "plans_select_all" ON public.plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "plans_admin_all" ON public.plans FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- TENANTS: super admin vê tudo; membros veem só os próprios
CREATE POLICY "tenants_admin_all" ON public.tenants FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "tenants_member_select" ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "tenants_owner_update" ON public.tenants FOR UPDATE TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), id));

-- PLATFORM_ADMINS: só super admin
CREATE POLICY "platform_admins_select_self" ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY "platform_admins_admin_all" ON public.platform_admins FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- TENANT_MEMBERS
CREATE POLICY "tm_select_self" ON public.tenant_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tm_admin_manage" ON public.tenant_members FOR ALL TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- SUBSCRIPTIONS
CREATE POLICY "subs_select" ON public.subscriptions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "subs_admin_all" ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- INVITATIONS
CREATE POLICY "inv_tenant_admin_all" ON public.invitations FOR ALL TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- AUDIT_LOGS
CREATE POLICY "audit_select" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND user_id = auth.uid());

-- CONVERSION_HISTORY
CREATE POLICY "conv_select" ON public.conversion_history FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "conv_insert" ON public.conversion_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND user_id = auth.uid());
CREATE POLICY "conv_admin_delete" ON public.conversion_history FOR DELETE TO authenticated
  USING (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- =====================================================================
-- 14. RLS NAS TABELAS DE DOMÍNIO — adicionar barreira tenant_id
--      (mantém políticas existentes; ADICIONA filtro tenant)
-- =====================================================================
-- TICKETS
DROP POLICY IF EXISTS "Admins can view all tickets" ON public.tickets;
DROP POLICY IF EXISTS "Admins can update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Admins can delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can create tickets" ON public.tickets;

CREATE POLICY "tickets_tenant_select" ON public.tickets FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids())
         AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR auth.uid() = created_by OR auth.uid() = requested_for));
CREATE POLICY "tickets_tenant_insert" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND auth.uid() = created_by);
CREATE POLICY "tickets_tenant_update" ON public.tickets FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));
CREATE POLICY "tickets_tenant_delete" ON public.tickets FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- TICKET_COMMENTS
DROP POLICY IF EXISTS "Users can view comments on own tickets" ON public.ticket_comments;
DROP POLICY IF EXISTS "Authenticated can add comments" ON public.ticket_comments;
DROP POLICY IF EXISTS "Admins can delete ticket comments" ON public.ticket_comments;
CREATE POLICY "tc_tenant_select" ON public.ticket_comments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "tc_tenant_insert" ON public.ticket_comments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND auth.uid() = user_id);
CREATE POLICY "tc_tenant_delete" ON public.ticket_comments FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- TICKET_ATTACHMENTS
DROP POLICY IF EXISTS "Admins can delete ticket attachments" ON public.ticket_attachments;
DROP POLICY IF EXISTS "Users can view attachments" ON public.ticket_attachments;
DROP POLICY IF EXISTS "Users can add attachments" ON public.ticket_attachments;
CREATE POLICY "ta_tenant_select" ON public.ticket_attachments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "ta_tenant_insert" ON public.ticket_attachments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND auth.uid() = user_id);
CREATE POLICY "ta_tenant_delete" ON public.ticket_attachments FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- TICKET_HISTORY
DROP POLICY IF EXISTS "Admins can delete ticket history" ON public.ticket_history;
DROP POLICY IF EXISTS "Users can view history of own tickets" ON public.ticket_history;
DROP POLICY IF EXISTS "System can insert history" ON public.ticket_history;
CREATE POLICY "th_tenant_select" ON public.ticket_history FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "th_tenant_insert" ON public.ticket_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND auth.uid() = user_id);
CREATE POLICY "th_tenant_delete" ON public.ticket_history FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- KB_ARTICLES
DROP POLICY IF EXISTS "Anyone authenticated can view articles" ON public.kb_articles;
DROP POLICY IF EXISTS "Admin/TI can manage articles" ON public.kb_articles;
CREATE POLICY "kba_tenant_select" ON public.kb_articles FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "kba_tenant_manage" ON public.kb_articles FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- KB_CATEGORIES
DROP POLICY IF EXISTS "Anyone authenticated can view categories" ON public.kb_categories;
DROP POLICY IF EXISTS "Admin/TI can manage categories" ON public.kb_categories;
CREATE POLICY "kbc_tenant_select" ON public.kb_categories FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "kbc_tenant_manage" ON public.kb_categories FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- KB_ARTICLE_STEPS
DROP POLICY IF EXISTS "Anyone authenticated can view steps" ON public.kb_article_steps;
DROP POLICY IF EXISTS "Admin/TI can manage steps" ON public.kb_article_steps;
CREATE POLICY "kbs_tenant_select" ON public.kb_article_steps FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "kbs_tenant_manage" ON public.kb_article_steps FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- RAMAIS
DROP POLICY IF EXISTS "Anyone authenticated can view ramais" ON public.ramais;
DROP POLICY IF EXISTS "Admin/TI can manage ramais" ON public.ramais;
CREATE POLICY "ram_tenant_select" ON public.ramais FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY "ram_tenant_manage" ON public.ramais FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- PASSWORDS_VAULT
DROP POLICY IF EXISTS "TI can select vault" ON public.passwords_vault;
DROP POLICY IF EXISTS "TI can insert vault" ON public.passwords_vault;
DROP POLICY IF EXISTS "TI can update vault" ON public.passwords_vault;
DROP POLICY IF EXISTS "TI can delete vault" ON public.passwords_vault;
CREATE POLICY "pv_tenant_admin_all" ON public.passwords_vault FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "notif_tenant_select" ON public.notifications FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND user_id = auth.uid());
CREATE POLICY "notif_tenant_update" ON public.notifications FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND user_id = auth.uid());
CREATE POLICY "notif_tenant_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids())
              AND (user_id = auth.uid() OR public.user_is_tenant_admin(auth.uid(), tenant_id)));
CREATE POLICY "notif_tenant_delete" ON public.notifications FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND user_id = auth.uid());

-- PROCESSED_EMAILS
DROP POLICY IF EXISTS "Admin/TI can view processed emails" ON public.processed_emails;
DROP POLICY IF EXISTS "Admin/TI can insert processed emails" ON public.processed_emails;
CREATE POLICY "pe_tenant_admin_select" ON public.processed_emails FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));
CREATE POLICY "pe_tenant_admin_insert" ON public.processed_emails FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()) AND public.user_is_tenant_admin(auth.uid(), tenant_id));

-- =====================================================================
-- 15. TRIGGERS updated_at
-- =====================================================================
CREATE TRIGGER trg_plans_updated   BEFORE UPDATE ON public.plans   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

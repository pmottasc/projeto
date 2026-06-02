-- ============================================================
-- Sistema de Faturamento Manual (vencimento dia 10)
-- ============================================================

-- 1) Tabela de billing por tenant
CREATE TABLE public.tenant_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  plan_id uuid,
  monthly_amount_cents integer NOT NULL DEFAULT 0,
  billing_day integer NOT NULL DEFAULT 10 CHECK (billing_day BETWEEN 1 AND 28),
  status text NOT NULL DEFAULT 'aguardando_pagamento'
    CHECK (status IN ('aguardando_pagamento','em_dia','atrasado','suspenso','cancelado')),
  next_invoice_date date,
  payment_pix_key text NOT NULL DEFAULT '',
  payment_bank_info text NOT NULL DEFAULT '',
  payment_instructions text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY tb_platform_admin_all ON public.tenant_billing
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY tb_tenant_admin_select ON public.tenant_billing
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_billing_updated
  BEFORE UPDATE ON public.tenant_billing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Tabela de faturas (histórico)
CREATE TABLE public.tenant_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plan_id uuid,
  reference_month text NOT NULL, -- 'YYYY-MM'
  amount_cents integer NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','paga','vencida','cancelada')),
  payment_method text NOT NULL DEFAULT '',
  receipt_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  marked_paid_by uuid,
  UNIQUE (tenant_id, reference_month)
);

CREATE INDEX idx_invoices_tenant_status ON public.tenant_invoices(tenant_id, status);
CREATE INDEX idx_invoices_due_date ON public.tenant_invoices(due_date) WHERE status IN ('pendente','vencida');

ALTER TABLE public.tenant_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY ti_platform_admin_all ON public.tenant_invoices
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY ti_tenant_admin_select ON public.tenant_invoices
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_invoices_updated
  BEFORE UPDATE ON public.tenant_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Função: calcula próximo dia de vencimento (próximo dia 10)
CREATE OR REPLACE FUNCTION public.next_billing_date(_from date, _day integer DEFAULT 10)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_target date;
BEGIN
  v_target := date_trunc('month', _from)::date + (_day - 1);
  IF v_target <= _from THEN
    v_target := (date_trunc('month', _from) + interval '1 month')::date + (_day - 1);
  END IF;
  RETURN v_target;
END;
$$;

-- 4) Função: gera fatura do mês para um tenant
CREATE OR REPLACE FUNCTION public.generate_invoice_for_tenant(_tenant_id uuid, _ref_month text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing public.tenant_billing%ROWTYPE;
  v_ref text;
  v_due date;
  v_invoice_id uuid;
BEGIN
  SELECT * INTO v_billing FROM public.tenant_billing WHERE tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing não configurado para tenant %', _tenant_id;
  END IF;

  v_ref := COALESCE(_ref_month, to_char(now(), 'YYYY-MM'));
  v_due := (v_ref || '-' || lpad(v_billing.billing_day::text, 2, '0'))::date;

  INSERT INTO public.tenant_invoices (tenant_id, plan_id, reference_month, amount_cents, due_date)
  VALUES (_tenant_id, v_billing.plan_id, v_ref, v_billing.monthly_amount_cents, v_due)
  ON CONFLICT (tenant_id, reference_month) DO UPDATE SET amount_cents = EXCLUDED.amount_cents
  RETURNING id INTO v_invoice_id;

  UPDATE public.tenant_billing SET next_invoice_date = v_due WHERE tenant_id = _tenant_id;
  RETURN v_invoice_id;
END;
$$;

-- 5) Função: marca fatura como paga e libera tenant
CREATE OR REPLACE FUNCTION public.mark_invoice_paid(_invoice_id uuid, _method text DEFAULT 'pix', _receipt text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.tenant_invoices%ROWTYPE;
  v_next_ref text;
  v_next_invoice uuid;
BEGIN
  IF NOT is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas SuperAdmin pode marcar faturas como pagas';
  END IF;

  SELECT * INTO v_inv FROM public.tenant_invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada'; END IF;

  UPDATE public.tenant_invoices
     SET status = 'paga', paid_at = now(), payment_method = _method,
         receipt_url = _receipt, marked_paid_by = auth.uid()
   WHERE id = _invoice_id;

  UPDATE public.tenant_billing SET status = 'em_dia' WHERE tenant_id = v_inv.tenant_id;
  UPDATE public.tenants SET status = 'active' WHERE id = v_inv.tenant_id;

  -- Gera próxima fatura (mês seguinte)
  v_next_ref := to_char((v_inv.reference_month || '-01')::date + interval '1 month', 'YYYY-MM');
  v_next_invoice := public.generate_invoice_for_tenant(v_inv.tenant_id, v_next_ref);

  RETURN jsonb_build_object('ok', true, 'next_invoice_id', v_next_invoice, 'next_ref', v_next_ref);
END;
$$;

-- 6) Função: verifica e marca faturas vencidas + suspende tenants atrasados
CREATE OR REPLACE FUNCTION public.check_overdue_invoices(_tolerance_days integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overdue_count integer := 0;
  v_suspended_count integer := 0;
BEGIN
  -- Marca faturas vencidas
  UPDATE public.tenant_invoices
     SET status = 'vencida'
   WHERE status = 'pendente' AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_overdue_count = ROW_COUNT;

  -- Atualiza billing para 'atrasado'
  UPDATE public.tenant_billing tb
     SET status = 'atrasado'
   WHERE tb.status = 'em_dia'
     AND EXISTS (SELECT 1 FROM public.tenant_invoices i
                  WHERE i.tenant_id = tb.tenant_id AND i.status = 'vencida');

  -- Suspende tenants com fatura vencida há mais que tolerância
  UPDATE public.tenants t
     SET status = 'suspended'
   WHERE t.status = 'active'
     AND EXISTS (SELECT 1 FROM public.tenant_invoices i
                  WHERE i.tenant_id = t.id AND i.status = 'vencida'
                    AND i.due_date < CURRENT_DATE - _tolerance_days);
  GET DIAGNOSTICS v_suspended_count = ROW_COUNT;

  UPDATE public.tenant_billing tb
     SET status = 'suspenso'
   WHERE tb.tenant_id IN (SELECT id FROM public.tenants WHERE status = 'suspended')
     AND tb.status != 'suspenso';

  RETURN jsonb_build_object('overdue_marked', v_overdue_count, 'tenants_suspended', v_suspended_count);
END;
$$;

-- 7) Trigger: ao criar tenant, cria billing e suspende até pagamento
CREATE OR REPLACE FUNCTION public.seed_tenant_billing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := 0;
BEGIN
  IF NEW.plan_id IS NOT NULL THEN
    SELECT price_cents INTO v_amount FROM public.plans WHERE id = NEW.plan_id;
  END IF;

  INSERT INTO public.tenant_billing (tenant_id, plan_id, monthly_amount_cents, status, next_invoice_date)
  VALUES (NEW.id, NEW.plan_id, COALESCE(v_amount, 0), 'aguardando_pagamento',
          public.next_billing_date(CURRENT_DATE, 10))
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_tenant_billing
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_tenant_billing();

-- 8) Seed billing para tenants existentes
INSERT INTO public.tenant_billing (tenant_id, plan_id, monthly_amount_cents, status, next_invoice_date)
SELECT t.id, t.plan_id, COALESCE(p.price_cents, 0), 'em_dia',
       public.next_billing_date(CURRENT_DATE, 10)
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
ON CONFLICT (tenant_id) DO NOTHING;
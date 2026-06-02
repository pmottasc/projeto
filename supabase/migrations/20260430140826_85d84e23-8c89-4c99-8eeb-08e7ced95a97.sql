-- Drop old CHECK constraints if they exist
ALTER TABLE public.tenant_billing DROP CONSTRAINT IF EXISTS tenant_billing_status_check;
ALTER TABLE public.tenant_invoices DROP CONSTRAINT IF EXISTS tenant_invoices_status_check;

-- Recreate with isento/isenta allowed
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_status_check
  CHECK (status IN ('aguardando_pagamento','em_dia','atrasado','suspenso','isento'));

ALTER TABLE public.tenant_invoices
  ADD CONSTRAINT tenant_invoices_status_check
  CHECK (status IN ('pendente','paga','vencida','cancelada','isenta'));

-- Add billing_exempt flag
ALTER TABLE public.tenant_billing
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

-- Mark Tell as exempt
UPDATE public.tenant_billing
   SET billing_exempt = true,
       status = 'isento',
       monthly_amount_cents = 0
 WHERE tenant_id = '14160ba6-bf2e-4c46-9d8c-efd5e72fcc99';

UPDATE public.tenant_invoices
   SET status = 'isenta'
 WHERE tenant_id = '14160ba6-bf2e-4c46-9d8c-efd5e72fcc99'
   AND status IN ('pendente','vencida');

UPDATE public.tenants SET status = 'active'
 WHERE id = '14160ba6-bf2e-4c46-9d8c-efd5e72fcc99' AND status = 'suspended';

-- Update functions to respect exemption
CREATE OR REPLACE FUNCTION public.check_overdue_invoices(_tolerance_days integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_overdue_count integer := 0;
  v_suspended_count integer := 0;
BEGIN
  UPDATE public.tenant_invoices i
     SET status = 'vencida'
   WHERE i.status = 'pendente' AND i.due_date < CURRENT_DATE
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_billing tb
        WHERE tb.tenant_id = i.tenant_id AND tb.billing_exempt = true
     );
  GET DIAGNOSTICS v_overdue_count = ROW_COUNT;

  UPDATE public.tenant_billing tb
     SET status = 'atrasado'
   WHERE tb.status = 'em_dia'
     AND tb.billing_exempt = false
     AND EXISTS (SELECT 1 FROM public.tenant_invoices i
                  WHERE i.tenant_id = tb.tenant_id AND i.status = 'vencida');

  UPDATE public.tenants t
     SET status = 'suspended'
   WHERE t.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_billing tb
        WHERE tb.tenant_id = t.id AND tb.billing_exempt = true
     )
     AND EXISTS (SELECT 1 FROM public.tenant_invoices i
                  WHERE i.tenant_id = t.id AND i.status = 'vencida'
                    AND i.due_date < CURRENT_DATE - _tolerance_days);
  GET DIAGNOSTICS v_suspended_count = ROW_COUNT;

  UPDATE public.tenant_billing tb
     SET status = 'suspenso'
   WHERE tb.tenant_id IN (SELECT id FROM public.tenants WHERE status = 'suspended')
     AND tb.status != 'suspenso'
     AND tb.billing_exempt = false;

  RETURN jsonb_build_object('overdue_marked', v_overdue_count, 'tenants_suspended', v_suspended_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_invoice_for_tenant(_tenant_id uuid, _ref_month text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF v_billing.billing_exempt THEN
    RETURN NULL;
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
$function$;
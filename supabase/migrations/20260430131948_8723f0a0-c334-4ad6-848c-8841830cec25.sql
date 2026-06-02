-- 1) Adicionar coluna de limite de mensagens IA aos planos
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_ai_messages_per_month integer NOT NULL DEFAULT 1000;

-- 2) Tabela de contadores de uso por tenant + mês
CREATE TABLE IF NOT EXISTS public.tenant_usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period_month text NOT NULL, -- formato YYYY-MM
  counter_key text NOT NULL,  -- 'conversions' | 'ai_messages'
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month, counter_key)
);

ALTER TABLE public.tenant_usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tuc_admin_select ON public.tenant_usage_counters;
CREATE POLICY tuc_admin_select ON public.tenant_usage_counters
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (public.user_is_tenant_admin(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
);

CREATE INDEX IF NOT EXISTS tuc_lookup_idx
  ON public.tenant_usage_counters (tenant_id, period_month, counter_key);

-- 3) Função para checar e incrementar quota atomicamente
CREATE OR REPLACE FUNCTION public.check_tenant_quota(
  _tenant_id uuid,
  _counter_key text,
  _increment integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text := to_char(now(), 'YYYY-MM');
  v_limit integer := 0;
  v_current integer := 0;
  v_plan_slug text := '';
BEGIN
  -- Pega limite do plano ativo
  SELECT
    CASE _counter_key
      WHEN 'conversions' THEN p.max_conversions_per_month
      WHEN 'ai_messages' THEN p.max_ai_messages_per_month
      ELSE 0
    END,
    p.slug
  INTO v_limit, v_plan_slug
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = _tenant_id;

  -- Sem plano = sem limite (libera). Tenants sem plan_id são tratados como ilimitados.
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_limit := 999999999;
  END IF;

  -- Lê contador atual
  SELECT count INTO v_current
    FROM public.tenant_usage_counters
   WHERE tenant_id = _tenant_id
     AND period_month = v_period
     AND counter_key = _counter_key;

  v_current := COALESCE(v_current, 0);

  -- Bloqueia se já estourou
  IF v_current + _increment > v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'limit', v_limit,
      'current', v_current,
      'plan', v_plan_slug,
      'period', v_period
    );
  END IF;

  -- Incrementa atomicamente
  INSERT INTO public.tenant_usage_counters (tenant_id, period_month, counter_key, count)
  VALUES (_tenant_id, v_period, _counter_key, _increment)
  ON CONFLICT (tenant_id, period_month, counter_key)
  DO UPDATE SET count = tenant_usage_counters.count + _increment,
                updated_at = now();

  RETURN jsonb_build_object(
    'allowed', true,
    'limit', v_limit,
    'current', v_current + _increment,
    'plan', v_plan_slug,
    'period', v_period
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_tenant_quota(uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_tenant_quota(uuid, text, integer) TO service_role;
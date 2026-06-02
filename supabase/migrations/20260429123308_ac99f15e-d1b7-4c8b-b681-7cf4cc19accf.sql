
-- Função que popula tenant_features com todas as features habilitadas por padrão
CREATE OR REPLACE FUNCTION public.seed_tenant_features()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
  VALUES
    (NEW.id, 'work_links', true),
    (NEW.id, 'central_atendimento', true),
    (NEW.id, 'pdf_to_ofx', true),
    (NEW.id, 'document_converter', true),
    (NEW.id, 'password_vault', true),
    (NEW.id, 'knowledge_base', true),
    (NEW.id, 'ramais', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger que dispara após a criação de um novo tenant
DROP TRIGGER IF EXISTS trg_seed_tenant_features ON public.tenants;
CREATE TRIGGER trg_seed_tenant_features
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.seed_tenant_features();

-- Garante uma constraint única para evitar duplicatas em tenant_features
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_features_tenant_feature_unique'
  ) THEN
    ALTER TABLE public.tenant_features
    ADD CONSTRAINT tenant_features_tenant_feature_unique UNIQUE (tenant_id, feature_key);
  END IF;
END $$;

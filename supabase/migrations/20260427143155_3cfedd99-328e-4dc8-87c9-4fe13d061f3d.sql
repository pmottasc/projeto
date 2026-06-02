INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT id, 'central_atendimento', true FROM public.tenants
ON CONFLICT DO NOTHING;
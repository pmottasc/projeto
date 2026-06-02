import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { FEATURES } from '@/lib/features';

const featureCache = new Map<string, Record<string, boolean>>();

/**
 * Retorna o mapa { feature_key: enabled } para o tenant atual.
 *
 * IMPORTANTE: enquanto `loading` for true, o consumidor NÃO deve renderizar
 * itens controlados por feature flag, para evitar flash (item aparece no
 * login e some quando o banco responde).
 *
 * `isEnabled(key)` retorna `false` enquanto carregando — assim itens só
 * aparecem após confirmação do banco.
 */
export function useTenantFeatures() {
  const { tenantId, loading: tenantLoading } = useTenant();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => (
    tenantId ? featureCache.get(tenantId) ?? {} : {}
  ));
  const [loading, setLoading] = useState(() => !(tenantId && featureCache.has(tenantId)));
  const loadedTenantRef = useRef<string | null>(tenantId && featureCache.has(tenantId) ? tenantId : null);

  const load = useCallback(async () => {
    // Aguarda contexto de tenant terminar de carregar
    if (tenantLoading) return;

    if (!tenantId) {
      setEnabled({});
      setLoading(false);
      loadedTenantRef.current = null;
      return;
    }

    const cached = featureCache.get(tenantId);
    if (cached) {
      setEnabled(cached);
      setLoading(false);
      loadedTenantRef.current = tenantId;
    } else if (loadedTenantRef.current !== tenantId) {
      setLoading(true);
    }

    const { data } = await supabase
      .from('tenant_features')
      .select('feature_key, enabled')
      .eq('tenant_id', tenantId);

    const overrides = Object.fromEntries((data || []).map(r => [r.feature_key, r.enabled]));
    const merged = Object.fromEntries(
      FEATURES.map(f => [f.key, overrides[f.key] ?? f.defaultEnabled])
    );
    featureCache.set(tenantId, merged);
    setEnabled(merged);
    setLoading(false);
    loadedTenantRef.current = tenantId;
  }, [tenantId, tenantLoading]);

  useEffect(() => { void load(); }, [load]);

  // Usa o último estado confirmado em cache, mesmo durante refreshes,
  // para o menu não piscar/sumir ao trocar de abas.
  const isEnabled = useCallback(
    (key: string) => enabled[key] === true,
    [enabled]
  );

  return { enabled, isEnabled, loading, refresh: load };
}

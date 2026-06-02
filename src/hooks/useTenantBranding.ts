import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface TenantBranding {
  tenant_id: string;
  logo_url: string;
  logo_path: string;
  primary_hsl: string;   // ex: "215 95% 56%"
  accent_hsl: string;
  secondary_hsl: string;
  use_gradient: boolean;
  app_name: string;
}

const DEFAULTS: Omit<TenantBranding, 'tenant_id'> = {
  logo_url: '',
  logo_path: '',
  primary_hsl: '215 95% 56%',
  accent_hsl: '268 78% 58%',
  secondary_hsl: '328 88% 56%',
  use_gradient: true,
  app_name: '',
};

/**
 * Loads the active tenant's branding and applies CSS variables on :root.
 * Falls back to default brand tokens when no branding exists.
 */
export function useTenantBranding() {
  const { tenantId } = useTenant();
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!tenantId) {
      resetCssVars();
      setBranding(null);
      return;
    }

    setLoading(true);
    supabase
      .from('tenant_branding')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const b: TenantBranding = data
          ? (data as TenantBranding)
          : { tenant_id: tenantId, ...DEFAULTS };
        setBranding(b);
        applyCssVars(b);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tenantId]);

  return { branding, loading };
}

function applyCssVars(b: TenantBranding) {
  const root = document.documentElement;
  root.style.setProperty('--brand-blue', b.primary_hsl);
  root.style.setProperty('--brand-violet', b.accent_hsl);
  root.style.setProperty('--brand-magenta', b.secondary_hsl);
  root.style.setProperty('--primary', b.primary_hsl);
  root.style.setProperty('--ring', b.primary_hsl);
  root.style.setProperty('--accent', b.accent_hsl);
}

function resetCssVars() {
  const root = document.documentElement;
  ['--brand-blue', '--brand-violet', '--brand-magenta', '--primary', '--ring', '--accent']
    .forEach(v => root.style.removeProperty(v));
}

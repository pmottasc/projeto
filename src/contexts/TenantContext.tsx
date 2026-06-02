import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'inactive' | 'trial';
  plan_id: string | null;
}

export interface TenantMembership extends Tenant {
  role: 'owner' | 'admin' | 'member';
}

interface TenantContextType {
  tenantId: string | null;
  tenant: TenantMembership | null;
  memberships: TenantMembership[];
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  loading: boolean;
  switchTenant: (id: string) => void;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | null>(null);
const STORAGE_KEY = 'hub:current_tenant';

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setMemberships([]); setTenantId(null); setIsPlatformAdmin(false); setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: members }, { data: padmin }] = await Promise.all([
      supabase
        .from('tenant_members')
        .select('role, tenants:tenant_id(id, slug, name, status, plan_id)')
        .eq('user_id', user.id),
      supabase.from('platform_admins').select('id').eq('user_id', user.id).maybeSingle(),
    ]);

    const mapped: TenantMembership[] = (members || [])
      .filter((m: any) => m.tenants)
      .map((m: any) => ({ ...m.tenants, role: m.role }));

    setMemberships(mapped);
    setIsPlatformAdmin(!!padmin);

    // Validate stored tenant against current memberships.
    // If the stored tenant is no longer in the user's memberships
    // (e.g. they were removed), discard it and pick the first valid one.
    const stored = localStorage.getItem(STORAGE_KEY);
    const validStored = mapped.find(t => t.id === stored)?.id;
    const initial = validStored || mapped[0]?.id || null;
    setTenantId(initial);
    if (initial) {
      localStorage.setItem(STORAGE_KEY, initial);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  const switchTenant = useCallback((id: string) => {
    setTenantId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const tenant = memberships.find(m => m.id === tenantId) || null;
  const isTenantAdmin = tenant?.role === 'owner' || tenant?.role === 'admin';

  return (
    <TenantContext.Provider value={{ tenantId, tenant, memberships, isPlatformAdmin, isTenantAdmin, loading, switchTenant, refresh: load }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    return {
      tenantId: null,
      tenant: null,
      memberships: [],
      isPlatformAdmin: false,
      isTenantAdmin: false,
      loading: false,
      switchTenant: () => {},
      refresh: async () => {},
    } as TenantContextType;
  }
  return ctx;
}

/** Helper: jogar erro amigável se faltar tenant. */
export function requireTenantId(tenantId: string | null): string {
  if (!tenantId) throw new Error('Nenhum tenant ativo. Faça login novamente.');
  return tenantId;
}

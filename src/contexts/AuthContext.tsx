import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'supervisor' | 'user';

export interface AppUser {
  id: string;
  username: string;
  name: string;
  role: AppRole;
  active: boolean;
}

interface AuthContextType {
  user: AppUser | null;
  supabaseUser: SupabaseUser | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  isAdmin: boolean;          // somente Administrador
  isSupervisor: boolean;     // somente Supervisor
  isStaff: boolean;          // Administrador OU Supervisor
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_SYNC_TIMEOUT_MS = 5000;

async function fetchAppUser(userId: string): Promise<AppUser | null> {
  const [{ data: profile }, { data: roleData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single(),
  ]);

  if (!profile) return null;

  if (!profile.active) return null;

  return {
    id: userId,
    username: profile.username,
    name: profile.name,
    role: (roleData?.role as AppRole) || 'user',
    active: profile.active,
  };
}

async function fetchAppUserWithTimeout(userId: string): Promise<AppUser | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      fetchAppUser(userId),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), AUTH_SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const syncVersionRef = useRef(0);

  const syncUser = useCallback(async (sessionUser: SupabaseUser | null) => {
    const syncVersion = ++syncVersionRef.current;

    if (!mountedRef.current) return;

    if (!sessionUser) {
      setSupabaseUser(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setSupabaseUser(sessionUser);

    try {
      const appUser = await fetchAppUserWithTimeout(sessionUser.id);

      if (!mountedRef.current || syncVersionRef.current !== syncVersion) return;

      setUser(appUser);
    } catch (e) {
      if (!mountedRef.current || syncVersionRef.current !== syncVersion) return;

      console.error('Error fetching user:', e);
      setUser(null);
    } finally {
      if (mountedRef.current && syncVersionRef.current === syncVersion) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);

    supabase.auth.getSession()
      .then(({ data: { session } }) => syncUser(session?.user ?? null))
      .catch((e) => {
        console.error('Error restoring session:', e);
        if (!mountedRef.current) return;
        setSupabaseUser(null);
        setUser(null);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncUser(session?.user ?? null);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [syncUser]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    return null;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
  }, []);

  const isAdmin = user?.role === 'admin';
  const isSupervisor = user?.role === 'supervisor';
  const isStaff = isAdmin || isSupervisor;

  return (
    <AuthContext.Provider value={{ user, supabaseUser, login, logout, isAdmin, isSupervisor, isStaff, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

export type PresenceStatus = 'online' | 'offline' | 'busy' | 'away' | 'invisible';

const HEARTBEAT_MS = 25_000;
const IDLE_AWAY_MS = 5 * 60_000; // 5 minutos sem interação => ausente
const STORAGE_KEY = 'chat_manual_status';

export function usePresence() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [manualStatus, setManualStatusState] = useState<PresenceStatus | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? (v as PresenceStatus) : null;
  });
  const [isIdle, setIsIdle] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const computeEffective = useCallback((): PresenceStatus => {
    if (manualStatus === 'invisible') return 'offline';
    if (manualStatus) return manualStatus;
    if (document.visibilityState === 'hidden') return 'away';
    if (isIdle) return 'away';
    return 'online';
  }, [manualStatus, isIdle]);

  const push = useCallback(async (status: PresenceStatus) => {
    if (!user || !tenantId) return;
    await supabase.from('chat_presence').upsert({
      user_id: user.id,
      tenant_id: tenantId,
      status,
      manual_status: manualStatus,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }, [user, tenantId, manualStatus]);

  // Detecção de inatividade (mouse/teclado/touch/scroll)
  useEffect(() => {
    if (!user || !tenantId) return;

    const resetIdle = () => {
      lastActivityRef.current = Date.now();
      if (isIdle) setIsIdle(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIsIdle(true), IDLE_AWAY_MS);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel',
    ];
    events.forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
    resetIdle();

    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetIdle));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [user, tenantId, isIdle]);

  useEffect(() => {
    if (!user || !tenantId) return;

    const beat = () => void push(computeEffective());
    beat();
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);

    const onVis = () => beat();
    document.addEventListener('visibilitychange', onVis);

    const onUnload = () => {
      // best effort offline
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/chat_presence?on_conflict=user_id`,
        new Blob([JSON.stringify({
          user_id: user.id,
          tenant_id: tenantId,
          status: 'offline',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
      void push('offline');
    };
  }, [user, tenantId, push, computeEffective]);

  const setManualStatus = useCallback((s: PresenceStatus | null) => {
    if (s) localStorage.setItem(STORAGE_KEY, s);
    else localStorage.removeItem(STORAGE_KEY);
    setManualStatusState(s);
  }, []);

  return { manualStatus, setManualStatus, effectiveStatus: computeEffective() };
}

export function presenceColor(s: PresenceStatus | undefined | null): string {
  switch (s) {
    case 'online': return 'bg-green-500';
    case 'busy': return 'bg-red-500';
    case 'away': return 'bg-yellow-500';
    case 'invisible':
    case 'offline':
    default: return 'bg-gray-400';
  }
}

export function presenceLabel(s: PresenceStatus | undefined | null): string {
  switch (s) {
    case 'online': return 'Online';
    case 'busy': return 'Ocupado';
    case 'away': return 'Ausente';
    case 'invisible': return 'Invisível';
    case 'offline':
    default: return 'Offline';
  }
}

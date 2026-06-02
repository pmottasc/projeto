import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

/**
 * Tracks unread internal chat messages for the current user.
 * Counts messages in conversations the user participates in,
 * created after their last_read_at and not sent by themselves.
 *
 * Calls onIncrement(prev, next) when the unread count rises (useful for sounds).
 */
export function useChatUnread(onIncrement?: (prev: number, next: number) => void) {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [unread, setUnread] = useState(0);
  const [, setUnreadConversations] = useState(0);
  const unreadRef = useRef(0);
  const initRef = useRef(false);
  const cbRef = useRef(onIncrement);
  cbRef.current = onIncrement;

  useEffect(() => {
    if (!user || !tenantId) {
      setUnread(0);
      setUnreadConversations(0);
      unreadRef.current = 0;
      initRef.current = false;
      return;
    }
    let cancelled = false;

    const fetchUnread = async () => {
      const { data: parts } = await supabase
        .from('chat_participants')
        .select('conversation_id, last_read_at, archived_at')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId);

      const active = (parts || []).filter((p: any) => !p.archived_at);
      if (active.length === 0) {
        if (cancelled) return;
        setUnread(0);
        setUnreadConversations(0);
        unreadRef.current = 0;
        initRef.current = true;
        return;
      }

      let total = 0;
      let convsWithUnread = 0;
      await Promise.all(
        active.map(async (p: any) => {
          const { count } = await supabase
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', p.conversation_id)
            .gt('created_at', p.last_read_at || '1970-01-01')
            .neq('sender_id', user.id);
          const c = count || 0;
          total += c;
          if (c > 0) convsWithUnread += 1;
        })
      );
      if (cancelled) return;
      const prev = unreadRef.current;
      setUnread(total);
      setUnreadConversations(convsWithUnread);
      unreadRef.current = total;
      if (initRef.current && total > prev && cbRef.current) {
        cbRef.current(prev, total);
      }
      initRef.current = true;
    };

    void fetchUnread();
    const ch = supabase
      .channel(`chat-unread-${tenantId}-${user.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => {
        void fetchUnread();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${user.id}` }, () => {
        void fetchUnread();
      })
      .subscribe();
    const interval = setInterval(fetchUnread, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [user, tenantId]);

  return unread;
}

/** Variant that returns both total messages and number of conversations with unread. */
export function useChatUnreadDetailed(onIncrement?: (prev: number, next: number) => void) {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [state, setState] = useState<{ total: number; conversations: number }>({ total: 0, conversations: 0 });
  const totalRef = useRef(0);
  const initRef = useRef(false);
  const cbRef = useRef(onIncrement);
  cbRef.current = onIncrement;

  useEffect(() => {
    if (!user || !tenantId) {
      setState({ total: 0, conversations: 0 });
      totalRef.current = 0;
      initRef.current = false;
      return;
    }
    let cancelled = false;

    const fetchUnread = async () => {
      const { data: parts } = await supabase
        .from('chat_participants')
        .select('conversation_id, last_read_at, archived_at')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId);

      const active = (parts || []).filter((p: any) => !p.archived_at);
      if (active.length === 0) {
        if (cancelled) return;
        setState({ total: 0, conversations: 0 });
        totalRef.current = 0;
        initRef.current = true;
        return;
      }

      let total = 0;
      let convs = 0;
      await Promise.all(
        active.map(async (p: any) => {
          const { count } = await supabase
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', p.conversation_id)
            .gt('created_at', p.last_read_at || '1970-01-01')
            .neq('sender_id', user.id);
          const c = count || 0;
          total += c;
          if (c > 0) convs += 1;
        })
      );
      if (cancelled) return;
      const prev = totalRef.current;
      setState({ total, conversations: convs });
      totalRef.current = total;
      if (initRef.current && total > prev && cbRef.current) {
        cbRef.current(prev, total);
      }
      initRef.current = true;
    };

    void fetchUnread();
    const ch = supabase
      .channel(`chat-unread-d-${tenantId}-${user.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => { void fetchUnread(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${user.id}` }, () => { void fetchUnread(); })
      .subscribe();
    const interval = setInterval(fetchUnread, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [user, tenantId]);

  return state;
}


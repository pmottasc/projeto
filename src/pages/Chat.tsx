import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePresence, presenceColor, presenceLabel, type PresenceStatus } from '@/hooks/usePresence';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Paperclip, Send, Plus, Search, Users as UsersIcon, MoreVertical, Trash2, Download, FileText, Loader2, Smile, Sticker, Archive, ArchiveRestore, Eraser, ArrowLeft, Image as ImageIcon, Film, Music, Check, CheckCheck, UserPlus, UserMinus, LogOut, ShieldAlert, Reply, Forward, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import StickerPicker from '@/components/chat/StickerPicker';
import { TypingBubble } from '@/components/chat/TypingBubble';

interface Conversation {
  id: string;
  type: 'dm' | 'group';
  name: string;
  created_by: string;
  updated_at: string;
}
interface Participant {
  conversation_id: string;
  user_id: string;
  is_admin: boolean;
  archived_at?: string | null;
  hidden_at?: string | null;
  last_read_at?: string | null;
}
interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: 'text' | 'image' | 'video' | 'file';
  content: string;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_mime?: string | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_id?: string | null;
  forwarded_from?: string | null;
}
interface MemberProfile {
  user_id: string;
  name: string;
  username: string;
  avatar_url?: string | null;
}

interface ChatProps {
  embedded?: boolean;
}

export default function Chat({ embedded = false }: ChatProps) {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  usePresence();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [participants, setParticipants] = useState<Record<string, Participant[]>>({});
  const [myArchived, setMyArchived] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, { status: PresenceStatus; last_seen_at: string }>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<'dm' | 'group'>('dm');
  const [newName, setNewName] = useState('');
  const [newSelected, setNewSelected] = useState<string[]>([]);
  const [newSearch, setNewSearch] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ kind: 'clear' | 'delete' | 'disband' | 'leave' | 'kick'; convId: string; userId?: string; userName?: string } | null>(null);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMembersSelected, setAddMembersSelected] = useState<string[]>([]);
  const [addMembersSearch, setAddMembersSearch] = useState('');
  const [previewAtt, setPreviewAtt] = useState<{ path: string; name: string; mime: string; kind: 'image' | 'video' | 'file' } | null>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'media' | 'docs'>('media');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [unreadByConv, setUnreadByConv] = useState<Record<string, number>>({});
  const [lastReadByConv, setLastReadByConv] = useState<Record<string, string>>({});
  // typing: convId -> { userId -> timestamp(ms) }
  const [typingByConv, setTypingByConv] = useState<Record<string, Record<string, number>>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [forwardSelected, setForwardSelected] = useState<string[]>([]);
  const [forwardSearch, setForwardSearch] = useState('');
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingChannelRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);

  // ------- Members + presence -------
  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    const { data: tm } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId);
    const ids = (tm || []).map(m => m.user_id).filter(Boolean);
    if (ids.length === 0) { setMembers([]); return; }
    const { data: profs } = await supabase.from('profiles').select('user_id, name, username, avatar_url').in('user_id', ids);
    setMembers((profs || []) as MemberProfile[]);
    const { data: pres } = await supabase.from('chat_presence').select('user_id, status, last_seen_at').eq('tenant_id', tenantId);
    const map: Record<string, any> = {};
    (pres || []).forEach((p: any) => { map[p.user_id] = { status: p.status, last_seen_at: p.last_seen_at }; });
    setPresenceMap(map);
  }, [tenantId]);

  // ------- Conversations + participants -------
  const loadConversations = useCallback(async () => {
    if (!user || !tenantId) return;
    const { data: myParts } = await supabase
      .from('chat_participants')
      .select('conversation_id, archived_at, hidden_at')
      .eq('user_id', user.id);
    const allConvIds = (myParts || []).map((p: any) => p.conversation_id);
    const archived = new Set<string>((myParts || []).filter((p: any) => p.archived_at).map((p: any) => p.conversation_id));
    setMyArchived(archived);
    if (allConvIds.length === 0) { setConversations([]); setParticipants({}); return; }

    // Filtrar conversas ocultas (excluídas só pra mim) — a menos que tenha mensagem nova após hidden_at
    const hiddenMap = new Map<string, string>();
    (myParts || []).forEach((p: any) => { if (p.hidden_at) hiddenMap.set(p.conversation_id, p.hidden_at); });
    const visibleConvIds: string[] = [];
    const toUnhide: string[] = [];
    for (const cid of allConvIds) {
      const h = hiddenMap.get(cid);
      if (!h) { visibleConvIds.push(cid); continue; }
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', cid)
        .gt('created_at', h);
      if ((count || 0) > 0) { visibleConvIds.push(cid); toUnhide.push(cid); }
    }
    if (toUnhide.length > 0) {
      await supabase.from('chat_participants')
        .update({ hidden_at: null })
        .eq('user_id', user.id)
        .in('conversation_id', toUnhide);
    }
    if (visibleConvIds.length === 0) { setConversations([]); setParticipants({}); return; }

    const { data: convs } = await supabase
      .from('chat_conversations')
      .select('*')
      .in('id', visibleConvIds)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });
    setConversations((convs || []) as Conversation[]);

    const { data: parts } = await supabase
      .from('chat_participants')
      .select('conversation_id, user_id, is_admin, archived_at, hidden_at, last_read_at')
      .in('conversation_id', visibleConvIds);
    const grouped: Record<string, Participant[]> = {};
    const lastReadMap: Record<string, string> = {};
    (parts || []).forEach((p: any) => {
      grouped[p.conversation_id] = grouped[p.conversation_id] || [];
      grouped[p.conversation_id].push(p);
      if (p.user_id === user.id) lastReadMap[p.conversation_id] = p.last_read_at || '1970-01-01';
    });
    setParticipants(grouped);
    setLastReadByConv(lastReadMap);

    // Calcula não lidas por conversa (mensagens > last_read_at e não próprias)
    const unread: Record<string, number> = {};
    await Promise.all(visibleConvIds.map(async (cid) => {
      const lr = lastReadMap[cid] || '1970-01-01';
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', cid)
        .gt('created_at', lr)
        .neq('sender_id', user.id);
      unread[cid] = count || 0;
    }));
    setUnreadByConv(unread);
  }, [user, tenantId]);

  // ------- Messages -------
  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    const { data } = await supabase.from('chat_messages').select('*').eq('conversation_id', convId)
      .order('created_at', { ascending: true }).limit(500);
    setMessages((data || []) as Message[]);
    setLoadingMessages(false);
    if (user) {
      const now = new Date().toISOString();
      await supabase.from('chat_participants').update({ last_read_at: now })
        .eq('conversation_id', convId).eq('user_id', user.id);
      setUnreadByConv(prev => ({ ...prev, [convId]: 0 }));
      setLastReadByConv(prev => ({ ...prev, [convId]: now }));
    }
  }, [user]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);
  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { if (activeId) void loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);

  // ------- Realtime -------
  useEffect(() => {
    if (!user || !tenantId) return;
    const ch = supabase.channel('chat-rt-' + tenantId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (payload: any) => {
        const m = (payload.new || payload.old) as Message;
        if (!m) return;
        if (m.conversation_id === activeId) {
          if (payload.eventType === 'INSERT') setMessages(prev => [...prev, payload.new as Message]);
          else if (payload.eventType === 'UPDATE') setMessages(prev => prev.map(x => x.id === (payload.new as Message).id ? payload.new as Message : x));
          else if (payload.eventType === 'DELETE') setMessages(prev => prev.filter(x => x.id !== (payload.old as Message).id));
        }
        // Atualiza badge de não lidas incrementalmente
        if (payload.eventType === 'INSERT') {
          const nm = payload.new as Message;
          if (nm.sender_id !== user.id && nm.conversation_id !== activeId) {
            setUnreadByConv(prev => ({ ...prev, [nm.conversation_id]: (prev[nm.conversation_id] || 0) + 1 }));
          }
        }
        void loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants' }, () => { void loadConversations(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => { void loadConversations(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_presence' }, (payload: any) => {
        const r = payload.new as any;
        if (r) setPresenceMap(prev => ({ ...prev, [r.user_id]: { status: r.status, last_seen_at: r.last_seen_at } }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, tenantId, activeId, loadConversations]);

  // ------- Typing indicator (broadcast por conversa ativa) -------
  useEffect(() => {
    if (!user || !activeId) {
      typingChannelRef.current = null;
      return;
    }
    const channel = supabase.channel(`chat-typing-${activeId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'typing' }, (payload: any) => {
      const { userId, isTyping } = payload.payload || {};
      if (!userId || userId === user.id) return;
      setTypingByConv(prev => {
        const conv = { ...(prev[activeId] || {}) };
        if (isTyping) conv[userId] = Date.now();
        else delete conv[userId];
        return { ...prev, [activeId]: conv };
      });
    });
    channel.subscribe();
    typingChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [user, activeId]);

  // Limpa indicadores de "digitando" expirados (>4s sem novo evento)
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingByConv(prev => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, Record<string, number>> = {};
        for (const [cid, users] of Object.entries(prev)) {
          const filtered: Record<string, number> = {};
          for (const [uid, ts] of Object.entries(users)) {
            if (now - ts < 4000) filtered[uid] = ts;
            else changed = true;
          }
          if (Object.keys(filtered).length > 0) next[cid] = filtered;
          else if (prev[cid] && Object.keys(prev[cid]).length > 0) changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const sendTyping = useCallback((isTyping: boolean) => {
    const ch = typingChannelRef.current;
    if (!ch || !user) return;
    const now = Date.now();
    if (isTyping && now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = isTyping ? now : 0;
    try {
      ch.send({ type: 'broadcast', event: 'typing', payload: { userId: user.id, isTyping } });
    } catch {}
  }, [user]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ------- Helpers -------
  const memberById = useMemo(() => {
    const m: Record<string, MemberProfile> = {};
    members.forEach(x => { m[x.user_id] = x; });
    return m;
  }, [members]);

  const getConvDisplay = useCallback((c: Conversation) => {
    if (c.type === 'group') {
      return { name: c.name || 'Grupo', subtitle: `${(participants[c.id]?.length || 0)} participantes`, avatar: null as string | null, otherId: null as string | null };
    }
    const otherId = (participants[c.id] || []).find(p => p.user_id !== user?.id)?.user_id;
    const other = otherId ? memberById[otherId] : undefined;
    return {
      name: other?.name || other?.username || 'Conversa',
      subtitle: presenceLabel(presenceMap[otherId || '']?.status),
      avatar: other?.avatar_url || null,
      otherId: otherId || null,
    };
  }, [participants, memberById, presenceMap, user]);

  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = conversations.filter(c => view === 'archived' ? myArchived.has(c.id) : !myArchived.has(c.id));
    if (q) list = list.filter(c => getConvDisplay(c).name.toLowerCase().includes(q));
    return list;
  }, [conversations, search, getConvDisplay, view, myArchived]);

  const otherMembers = useMemo(
    () => members
      .filter(m => m.user_id !== user?.id)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' })),
    [members, user]
  );
  const filteredNewMembers = useMemo(() => {
    const q = newSearch.trim().toLowerCase();
    if (!q) return otherMembers;
    return otherMembers.filter(m => (m.name || '').toLowerCase().includes(q));
  }, [otherMembers, newSearch]);

  // ------- Actions -------
  const startOrOpenDM = async (otherId: string) => {
    if (!user || !tenantId) return;
    const existing = conversations.find(c => {
      if (c.type !== 'dm') return false;
      const ps = participants[c.id] || [];
      const ids = ps.map(p => p.user_id).sort();
      const target = [user.id, otherId].sort();
      return ids.length === 2 && ids[0] === target[0] && ids[1] === target[1];
    });
    if (existing) { setActiveId(existing.id); setShowNew(false); return; }
    const { data: conv, error } = await supabase.from('chat_conversations')
      .insert({ tenant_id: tenantId, type: 'dm', name: '', created_by: user.id }).select().single();
    if (error || !conv) { toast.error('Erro ao criar conversa'); return; }
    const { error: pErr } = await supabase.from('chat_participants').insert([
      { conversation_id: conv.id, tenant_id: tenantId, user_id: user.id, is_admin: true },
      { conversation_id: conv.id, tenant_id: tenantId, user_id: otherId, is_admin: false },
    ]);
    if (pErr) { toast.error('Erro ao adicionar participantes'); return; }
    await loadConversations();
    setActiveId(conv.id);
    setShowNew(false);
  };

  const createGroup = async () => {
    if (!user || !tenantId) return;
    if (!newName.trim()) { toast.error('Defina um nome para o grupo'); return; }
    if (newSelected.length === 0) { toast.error('Selecione ao menos 1 membro'); return; }
    const { data: conv, error } = await supabase.from('chat_conversations')
      .insert({ tenant_id: tenantId, type: 'group', name: newName.trim(), created_by: user.id }).select().single();
    if (error || !conv) { toast.error('Erro ao criar grupo'); return; }
    const rows = [
      { conversation_id: conv.id, tenant_id: tenantId, user_id: user.id, is_admin: true },
      ...newSelected.map(uid => ({ conversation_id: conv.id, tenant_id: tenantId, user_id: uid, is_admin: false })),
    ];
    const { error: pErr } = await supabase.from('chat_participants').insert(rows);
    if (pErr) { toast.error('Erro ao adicionar participantes'); return; }
    setNewName(''); setNewSelected([]); setShowNew(false);
    await loadConversations();
    setActiveId(conv.id);
  };

  const sendText = async (override?: string) => {
    if (!user || !tenantId || !activeId || sending) return;
    const body = (override ?? text).trim();
    if (!body) return;
    setSending(true);
    if (!override) setText('');
    if (editingMsg) {
      const target = editingMsg;
      const { error } = await supabase.from('chat_messages')
        .update({ content: body, edited_at: new Date().toISOString() })
        .eq('id', target.id);
      if (error) { toast.error('Erro ao editar'); if (!override) setText(body); }
      else { setEditingMsg(null); }
      setSending(false);
      return;
    }
    const replyId = replyTo?.id || null;
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: activeId, tenant_id: tenantId, sender_id: user.id, type: 'text', content: body,
      reply_to_id: replyId,
    });
    if (error) { toast.error('Erro ao enviar'); if (!override) setText(body); }
    else { setReplyTo(null); }
    setSending(false);
  };

  const startEditMessage = (m: Message) => {
    if (m.sender_id !== user?.id) return;
    if (m.type !== 'text') { toast.error('Só é possível editar mensagens de texto'); return; }
    setReplyTo(null);
    setEditingMsg(m);
    setText(m.content || '');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setText('');
  };

  const sendFile = async (file: File, caption?: string) => {
    if (!user || !tenantId || !activeId) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Arquivo muito grande (máx 50MB)'); return; }
    setSending(true);
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${user.id}/${activeId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('chat-attachments').upload(path, file, { upsert: false });
    if (upErr) { toast.error('Falha no upload: ' + upErr.message); setSending(false); return; }
    const mime = file.type || '';
    const type: Message['type'] = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: activeId, tenant_id: tenantId, sender_id: user.id,
      type, content: caption?.trim() || '', attachment_path: path, attachment_name: file.name, attachment_size: file.size, attachment_mime: mime,
    });
    if (error) toast.error('Erro ao registrar mensagem');
    setSending(false);
  };

  const openPendingFile = (file: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Arquivo muito grande (máx 50MB)'); return; }
    setPendingFile(file);
    setPendingCaption('');
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setPendingPreview(url);
    } else {
      setPendingPreview(null);
    }
  };

  const closePendingFile = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview(null);
    setPendingFile(null);
    setPendingCaption('');
  };

  const confirmPendingFile = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    const caption = pendingCaption;
    closePendingFile();
    await sendFile(file, caption);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeId) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          openPendingFile(file);
          return;
        }
      }
    }
  };

  const sendStickerUrl = async (url: string, name: string) => {
    if (!user || !tenantId || !activeId) return;
    setStickerOpen(false);
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: activeId, tenant_id: tenantId, sender_id: user.id,
      type: 'image', content: `__sticker__:${url}`,
      attachment_name: name, attachment_mime: 'image/sticker', attachment_size: 0,
    });
    if (error) toast.error('Erro ao enviar figurinha');
  };

  const deleteMessage = async (id: string) => {
    const { error } = await supabase.from('chat_messages').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
  };

  const archiveConv = async (convId: string, archive: boolean) => {
    if (!user) return;
    const { error } = await supabase.from('chat_participants')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('conversation_id', convId).eq('user_id', user.id);
    if (error) { toast.error('Erro ao arquivar'); return; }
    toast.success(archive ? 'Conversa arquivada' : 'Conversa desarquivada');
    if (archive && activeId === convId) setActiveId(null);
    await loadConversations();
  };

  const clearConv = async (convId: string) => {
    const { error } = await supabase.from('chat_messages').delete().eq('conversation_id', convId);
    if (error) { toast.error('Erro ao limpar: ' + error.message); return; }
    toast.success('Conversa limpa');
    if (activeId === convId) setMessages([]);
  };

  const deleteConv = async (convId: string) => {
    if (!user) return;
    // Exclusão "para mim": marca a conversa como oculta apenas para o usuário atual.
    // A outra pessoa continua vendo a conversa normalmente. Se ela enviar uma nova
    // mensagem, a conversa reaparece automaticamente para mim.
    const { error } = await supabase.from('chat_participants')
      .update({ hidden_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('user_id', user.id);
    if (error) { toast.error('Erro ao excluir: ' + error.message); return; }
    toast.success('Conversa excluída para você');
    if (activeId === convId) setActiveId(null);
    await loadConversations();
  };

  const addMembersToGroup = async (convId: string, userIds: string[]) => {
    if (!tenantId || userIds.length === 0) return;
    const rows = userIds.map(uid => ({ conversation_id: convId, tenant_id: tenantId, user_id: uid, is_admin: false }));
    const { error } = await supabase.from('chat_participants').insert(rows);
    if (error) { toast.error('Erro ao adicionar: ' + error.message); return; }
    toast.success(userIds.length === 1 ? 'Membro adicionado' : `${userIds.length} membros adicionados`);
    setAddMembersOpen(false);
    setAddMembersSelected([]);
    setAddMembersSearch('');
    await loadConversations();
  };

  const kickMember = async (convId: string, userId: string) => {
    const { error } = await supabase.from('chat_participants').delete()
      .eq('conversation_id', convId).eq('user_id', userId);
    if (error) { toast.error('Erro ao remover: ' + error.message); return; }
    toast.success('Membro removido do grupo');
    await loadConversations();
  };

  const leaveGroup = async (convId: string) => {
    if (!user) return;
    const { error } = await supabase.from('chat_participants').delete()
      .eq('conversation_id', convId).eq('user_id', user.id);
    if (error) { toast.error('Erro ao sair: ' + error.message); return; }
    toast.success('Você saiu do grupo');
    if (activeId === convId) setActiveId(null);
    await loadConversations();
  };

  const disbandGroup = async (convId: string) => {
    // Apaga mensagens, participantes e a conversa (somente criador ou admin do tenant via RLS)
    const { error: mErr } = await supabase.from('chat_messages').delete().eq('conversation_id', convId);
    if (mErr) { toast.error('Erro ao apagar mensagens: ' + mErr.message); return; }
    await supabase.from('chat_participants').delete().eq('conversation_id', convId);
    const { error: cErr } = await supabase.from('chat_conversations').delete().eq('id', convId);
    if (cErr) { toast.error('Erro ao desfazer grupo: ' + cErr.message); return; }
    toast.success('Grupo desfeito');
    if (activeId === convId) setActiveId(null);
    await loadConversations();
  };

  const forwardMessageTo = async (msg: Message, convIds: string[]) => {
    if (!user || !tenantId || convIds.length === 0) return;
    const rows = convIds.map(cid => ({
      conversation_id: cid,
      tenant_id: tenantId,
      sender_id: user.id,
      type: msg.type,
      content: msg.content || '',
      attachment_path: msg.attachment_path || null,
      attachment_name: msg.attachment_name || null,
      attachment_size: msg.attachment_size || null,
      attachment_mime: msg.attachment_mime || null,
      forwarded_from: msg.id,
    }));
    const { error } = await supabase.from('chat_messages').insert(rows);
    if (error) { toast.error('Erro ao encaminhar: ' + error.message); return; }
    toast.success(convIds.length === 1 ? 'Mensagem encaminhada' : `Encaminhada para ${convIds.length} conversas`);
    setForwardMsg(null);
    setForwardSelected([]);
    setForwardSearch('');
  };

  const messageById = useMemo(() => {
    const m: Record<string, Message> = {};
    messages.forEach(x => { m[x.id] = x; });
    return m;
  }, [messages]);

  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1500);
    }
  };

  const previewMessageText = (m: Message): string => {
    if (m.type === 'image') return m.content?.startsWith('__sticker__:') ? '🎴 Figurinha' : (m.content || '📷 Imagem');
    if (m.type === 'video') return m.content || '🎬 Vídeo';
    if (m.type === 'file') return m.content || `📎 ${m.attachment_name || 'Arquivo'}`;
    return m.content || '';
  };

  const insertEmoji = (e: any) => {
    const native = e?.native || '';
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta) {
      const start = ta.selectionStart || 0;
      const end = ta.selectionEnd || 0;
      const next = text.slice(0, start) + native + text.slice(end);
      setText(next);
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + native.length, start + native.length); });
    } else {
      setText(t => t + native);
    }
  };

  const publicUrl = (path: string) => supabase.storage.from('chat-attachments').getPublicUrl(path).data.publicUrl;

  const downloadAttachment = async (path: string, name: string, mime: string) => {
    try {
      const { data, error } = await supabase.storage.from('chat-attachments').download(path);
      if (error || !data) throw error || new Error('Falha no download');
      const blob = new Blob([data], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'arquivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) {
      toast.error('Erro ao baixar: ' + (e?.message || 'desconhecido'));
    }
  };

  const activeConv = conversations.find(c => c.id === activeId);
  const activeDisplay = activeConv ? getConvDisplay(activeConv) : null;

  // Confirmação de leitura: menor last_read_at entre os outros participantes da conversa ativa.
  // Mensagens próprias com created_at <= esse valor foram lidas por todos os destinatários.
  const othersMinReadAt = useMemo(() => {
    if (!activeId || !user) return null;
    const others = (participants[activeId] || []).filter(p => p.user_id !== user.id);
    if (others.length === 0) return null;
    const times = others.map(p => p.last_read_at || '1970-01-01');
    return times.reduce((a, b) => (a < b ? a : b));
  }, [activeId, participants, user]);

  return (
    <div className={cn('flex flex-col bg-background overflow-hidden', embedded ? 'h-full w-full' : '-m-8 h-[calc(100dvh-60px)]')}>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className={cn(
          'flex-col border-r border-border bg-card overflow-hidden',
          'md:flex md:w-96 lg:w-[420px] xl:w-[460px] md:shrink-0',
          activeId ? 'hidden md:flex' : 'flex w-full'
        )}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Conversas</h2>
            <Dialog open={showNew} onOpenChange={setShowNew}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8"><Plus className="h-4 w-4" /></Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Nova conversa</DialogTitle></DialogHeader>
                <div className="flex gap-2 mb-3">
                  <Button size="sm" variant={newType === 'dm' ? 'default' : 'outline'} onClick={() => setNewType('dm')}>Direta</Button>
                  <Button size="sm" variant={newType === 'group' ? 'default' : 'outline'} onClick={() => setNewType('group')}>Grupo</Button>
                </div>
                {newType === 'group' && (
                  <Input placeholder="Nome do grupo" value={newName} onChange={e => setNewName(e.target.value)} className="mb-3" />
                )}
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Buscar pessoa pelo nome..."
                    value={newSearch}
                    onChange={e => setNewSearch(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
                <ScrollArea className="h-64 border rounded-md p-2">
                  {filteredNewMembers.map(m => {
                    const checked = newSelected.includes(m.user_id);
                    return (
                      <button key={m.user_id}
                        onClick={() => {
                          if (newType === 'dm') void startOrOpenDM(m.user_id);
                          else setNewSelected(s => checked ? s.filter(x => x !== m.user_id) : [...s, m.user_id]);
                        }}
                        className={cn('flex w-full items-center gap-2 px-2 py-2 rounded-md hover:bg-accent', checked && 'bg-accent')}>
                        <div className="relative">
                          <Avatar className="h-8 w-8">
                            {m.avatar_url ? <AvatarImage src={m.avatar_url} /> : null}
                            <AvatarFallback>{m.name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card', presenceColor(presenceMap[m.user_id]?.status))} />
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <p className="text-sm truncate">{m.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{presenceLabel(presenceMap[m.user_id]?.status)}</p>
                        </div>
                        {newType === 'group' && checked && <span className="text-xs text-primary">✓</span>}
                      </button>
                    );
                  })}
                  {filteredNewMembers.length === 0 && (
                    <p className="text-sm text-muted-foreground p-3 text-center">
                      {otherMembers.length === 0 ? 'Nenhum outro usuário no tenant' : 'Nenhum resultado para a busca'}
                    </p>
                  )}
                </ScrollArea>
                {newType === 'group' && (
                  <DialogFooter className="mt-3"><Button onClick={createGroup}>Criar grupo</Button></DialogFooter>
                )}
              </DialogContent>
            </Dialog>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="pl-8 h-8" />
          </div>
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList className="grid grid-cols-2 h-8">
              <TabsTrigger value="active" className="text-xs">Ativas</TabsTrigger>
              <TabsTrigger value="archived" className="text-xs">
                Arquivadas {myArchived.size > 0 && `(${myArchived.size})`}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ScrollArea className="flex-1">
          {filteredConvs.map(c => {
            const d = getConvDisplay(c);
            const active = c.id === activeId;
            const isArchived = myArchived.has(c.id);
            const isOwner = c.created_by === user?.id;
            const unread = active ? 0 : (unreadByConv[c.id] || 0);
            const typingUsers = Object.keys(typingByConv[c.id] || {});
            const isTyping = typingUsers.length > 0;
            const subtitle = isTyping
              ? (c.type === 'group'
                  ? `${(memberById[typingUsers[0]]?.name || 'alguém').split(' ')[0]} está digitando…`
                  : 'digitando…')
              : d.subtitle;
            return (
              <ContextMenu key={c.id}>
                <ContextMenuTrigger asChild>
                  <button onClick={() => setActiveId(c.id)}
                    className={cn('flex w-full items-center gap-3 px-3 py-2.5 hover:bg-accent border-b border-border/50 text-left', active && 'bg-accent')}>
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        {d.avatar ? <AvatarImage src={d.avatar} /> : null}
                        <AvatarFallback>{c.type === 'group' ? <UsersIcon className="h-4 w-4" /> : d.name.charAt(0)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {c.type === 'dm' && d.otherId && (
                        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', presenceColor(presenceMap[d.otherId]?.status))} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm truncate', unread > 0 ? 'font-semibold' : 'font-medium')}>{d.name}</p>
                      <p className={cn('text-xs truncate', isTyping ? 'text-primary italic' : 'text-muted-foreground')}>{subtitle}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {unread > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                      {isArchived && <Archive className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => archiveConv(c.id, !isArchived)}>
                    {isArchived ? <><ArchiveRestore className="h-4 w-4 mr-2" />Desarquivar</> : <><Archive className="h-4 w-4 mr-2" />Arquivar</>}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setConfirmDialog({ kind: 'clear', convId: c.id })}>
                    <Eraser className="h-4 w-4 mr-2" /> Limpar conversa
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={() => setConfirmDialog({ kind: 'delete', convId: c.id })}>
                    <Trash2 className="h-4 w-4 mr-2" /> Excluir conversa para mim
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {filteredConvs.length === 0 && (
            <p className="text-sm text-muted-foreground p-6 text-center">
              {view === 'archived' ? 'Nenhuma conversa arquivada.' : 'Nenhuma conversa. Clique em + para começar.'}
            </p>
          )}
        </ScrollArea>
      </div>

      {/* Conversation panel */}
      <div className={cn(
        'flex-1 flex-col bg-card overflow-hidden min-w-0',
        activeConv ? 'flex' : 'hidden md:flex'
      )}>
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Selecione uma conversa para começar
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <Button size="icon" variant="ghost" className="md:hidden h-8 w-8 shrink-0" onClick={() => setActiveId(null)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  onClick={() => { setInfoTab('media'); setInfoPanelOpen(true); }}
                  className="flex items-center gap-2 min-w-0 text-left rounded-md hover:bg-muted/50 transition-colors px-1 py-0.5 -mx-1"
                  title="Ver informações e arquivos"
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      {activeDisplay?.avatar ? <AvatarImage src={activeDisplay.avatar} /> : null}
                      <AvatarFallback>{activeConv.type === 'group' ? <UsersIcon className="h-4 w-4" /> : activeDisplay?.name.charAt(0)?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {activeConv.type === 'dm' && activeDisplay?.otherId && (
                      <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', presenceColor(presenceMap[activeDisplay.otherId]?.status))} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate hover:underline">{activeDisplay?.name}</p>
                    {(() => {
                      const typingIds = Object.keys(typingByConv[activeConv.id] || {}).filter(uid => uid !== user?.id);
                      if (typingIds.length > 0) {
                        const label = activeConv.type === 'group'
                          ? `${typingIds.map(uid => (memberById[uid]?.name || '').split(' ')[0]).filter(Boolean).slice(0, 3).join(', ')} ${typingIds.length === 1 ? 'está' : 'estão'} digitando…`
                          : 'digitando…';
                        return <p className="text-xs text-primary italic">{label}</p>;
                      }
                      return (
                        <p className="text-xs text-muted-foreground truncate">
                          {activeConv.type === 'group'
                            ? (participants[activeConv.id] || []).map(p => memberById[p.user_id]?.name).filter(Boolean).slice(0, 4).join(', ')
                            : activeDisplay?.subtitle}
                        </p>
                      );
                    })()}
                  </div>
                </button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {activeConv.type === 'group' && (
                    <>
                      <DropdownMenuItem onClick={() => { setAddMembersSelected([]); setAddMembersSearch(''); setAddMembersOpen(true); }}>
                        <UserPlus className="h-4 w-4 mr-2" /> Adicionar membros
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setInfoTab('media'); setInfoPanelOpen(true); }}>
                        <UsersIcon className="h-4 w-4 mr-2" /> Gerenciar participantes
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => archiveConv(activeConv.id, !myArchived.has(activeConv.id))}>
                    {myArchived.has(activeConv.id)
                      ? <><ArchiveRestore className="h-4 w-4 mr-2" />Desarquivar</>
                      : <><Archive className="h-4 w-4 mr-2" />Arquivar</>}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConfirmDialog({ kind: 'clear', convId: activeConv.id })}>
                    <Eraser className="h-4 w-4 mr-2" /> Limpar conversa
                  </DropdownMenuItem>
                  {activeConv.type === 'group' && activeConv.created_by !== user?.id && (
                    <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDialog({ kind: 'leave', convId: activeConv.id })}>
                      <LogOut className="h-4 w-4 mr-2" /> Sair do grupo
                    </DropdownMenuItem>
                  )}
                  {activeConv.type === 'group' && activeConv.created_by === user?.id && (
                    <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDialog({ kind: 'disband', convId: activeConv.id })}>
                      <ShieldAlert className="h-4 w-4 mr-2" /> Desfazer grupo
                    </DropdownMenuItem>
                  )}
                  {activeConv.type === 'dm' && (
                    <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDialog({ kind: 'delete', convId: activeConv.id })}>
                      <Trash2 className="h-4 w-4 mr-2" /> Excluir conversa para mim
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <ScrollArea className="flex-1 px-6 py-5">
              {loadingMessages ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <div className="space-y-3 max-w-5xl mx-auto">
                  {messages.map(m => {
                    const mine = m.sender_id === user?.id;
                    const sender = memberById[m.sender_id];
                    const isSticker = m.type === 'image' && typeof m.content === 'string' && m.content.startsWith('__sticker__:');
                    const stickerUrl = isSticker ? m.content.replace('__sticker__:', '') : null;
                    const repliedMsg = m.reply_to_id ? messageById[m.reply_to_id] : null;
                    return (
                      <div key={m.id} id={`msg-${m.id}`} className={cn('flex gap-2 rounded-lg transition-shadow', mine ? 'justify-end' : 'justify-start')}>
                        {!mine && (
                          <Avatar className="h-7 w-7 mt-1">
                            {sender?.avatar_url ? <AvatarImage src={sender.avatar_url} /> : null}
                            <AvatarFallback className="text-xs">{sender?.name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                          </Avatar>
                        )}
                        <div className={cn('max-w-[78%] md:max-w-[72%] relative group',
                          isSticker ? '' : 'rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm',
                          isSticker ? '' : (mine ? 'bg-primary text-primary-foreground' : 'bg-muted'))}>
                          {!mine && activeConv.type === 'group' && !isSticker && (
                            <p className="text-[11px] font-semibold opacity-70 mb-1">{sender?.name}</p>
                          )}
                          {m.forwarded_from && !isSticker && (
                            <p className="text-[11px] italic opacity-70 mb-1 flex items-center gap-1">
                              <Forward className="h-3 w-3" /> Encaminhada
                            </p>
                          )}
                          {repliedMsg && !isSticker && (
                            <button
                              type="button"
                              onClick={() => scrollToMessage(repliedMsg.id)}
                              className={cn(
                                'block w-full text-left mb-2 px-2 py-1.5 rounded border-l-4 text-xs truncate',
                                mine ? 'bg-primary-foreground/15 border-primary-foreground/60' : 'bg-background/60 border-primary'
                              )}
                            >
                              <p className="font-semibold opacity-80">
                                {repliedMsg.sender_id === user?.id ? 'Você' : (memberById[repliedMsg.sender_id]?.name || 'Usuário')}
                              </p>
                              <p className="opacity-80 truncate">{previewMessageText(repliedMsg)}</p>
                            </button>
                          )}
                          {isSticker && stickerUrl && (
                            <img src={stickerUrl} alt="figurinha" className="max-h-40 max-w-40 object-contain" />
                          )}
                          {!isSticker && m.type === 'text' && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                          {!isSticker && m.type === 'image' && m.attachment_path && (
                            <button
                              type="button"
                              onClick={() => setPreviewAtt({ path: m.attachment_path!, name: m.attachment_name || 'imagem', mime: m.attachment_mime || 'image/*', kind: 'image' })}
                              className="block focus:outline-none">
                              <img src={publicUrl(m.attachment_path)} alt={m.attachment_name || ''} className="rounded-lg max-h-64 max-w-full cursor-zoom-in" />
                            </button>
                          )}
                          {m.type === 'video' && m.attachment_path && (
                            <video src={publicUrl(m.attachment_path)} controls className="rounded-lg max-h-64 max-w-full" />
                          )}
                          {m.type === 'file' && m.attachment_path && (
                            <button
                              type="button"
                              onClick={() => setPreviewAtt({ path: m.attachment_path!, name: m.attachment_name || 'arquivo', mime: m.attachment_mime || 'application/octet-stream', kind: 'file' })}
                              className="flex items-center gap-2 underline text-left">
                              <FileText className="h-4 w-4" /> {m.attachment_name}
                            </button>
                          )}
                          {!isSticker && (m.type === 'image' || m.type === 'video' || m.type === 'file') && m.content && (
                            <p className="whitespace-pre-wrap break-words mt-1.5">{m.content}</p>
                          )}
                          {!isSticker && (
                            <div className={cn('flex items-center gap-1 text-[10px] mt-1 opacity-80', mine ? 'justify-end' : 'justify-start')}>
                              {m.edited_at && <span className="italic opacity-70">editado</span>}
                              <span className="opacity-70">
                                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {mine && (() => {
                                const isRead = othersMinReadAt !== null && m.created_at <= othersMinReadAt;
                                return isRead
                                  ? <CheckCheck className="h-3.5 w-3.5 text-sky-400" />
                                  : <CheckCheck className="h-3.5 w-3.5 opacity-70" />;
                              })()}
                            </div>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className={cn(
                                'absolute -top-2 opacity-0 group-hover:opacity-100 bg-background border border-border rounded-full p-1',
                                mine ? '-right-2' : '-left-2'
                              )}>
                                <MoreVertical className="h-3 w-3 text-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={mine ? 'end' : 'start'}>
                              <DropdownMenuItem onClick={() => { setReplyTo(m); textareaRef.current?.focus(); }}>
                                <Reply className="h-4 w-4 mr-2" /> Responder
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setForwardSelected([]); setForwardSearch(''); setForwardMsg(m); }}>
                                <Forward className="h-4 w-4 mr-2" /> Encaminhar
                              </DropdownMenuItem>
                              {mine && m.type === 'text' && (
                                <DropdownMenuItem onClick={() => startEditMessage(m)}>
                                  <Pencil className="h-4 w-4 mr-2" /> Editar
                                </DropdownMenuItem>
                              )}
                              {mine && (
                                <DropdownMenuItem className="text-destructive" onClick={() => void deleteMessage(m.id)}>
                                  <Trash2 className="h-4 w-4 mr-2" /> Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const typingIds = Object.keys(typingByConv[activeConv.id] || {}).filter(uid => uid !== user?.id);
                    if (!typingIds.length) return null;
                    const name = activeConv.type === 'group'
                      ? typingIds.map(uid => (memberById[uid]?.name || '').split(' ')[0]).filter(Boolean).slice(0, 2).join(', ')
                      : (memberById[typingIds[0]]?.name?.split(' ')[0] || '');
                    return <TypingBubble name={name || undefined} align="left" />;
                  })()}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {editingMsg && (
              <div className="px-3 pt-2 -mb-1">
                <div className="flex items-start gap-2 bg-muted/60 border-l-4 border-primary rounded-md px-3 py-2">
                  <Pencil className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-primary">Editando mensagem</p>
                    <p className="text-xs text-muted-foreground truncate">{editingMsg.content}</p>
                  </div>
                  <button type="button" onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            {replyTo && !editingMsg && (
              <div className="px-3 pt-2 -mb-1">
                <div className="flex items-start gap-2 bg-muted/60 border-l-4 border-primary rounded-md px-3 py-2">
                  <Reply className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-primary">
                      Respondendo a {replyTo.sender_id === user?.id ? 'você' : (memberById[replyTo.sender_id]?.name || 'usuário')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{previewMessageText(replyTo)}</p>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            <div className="p-3 border-t border-border flex items-end gap-2">
              <input ref={fileInputRef} type="file" className="hidden"
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                onChange={e => { const f = e.target.files?.[0]; if (f) openPendingFile(f); e.target.value = ''; }} />
              <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={sending} title="Anexar">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" title="Emojis"><Smile className="h-4 w-4" /></Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="p-0 border-0 w-auto">
                  <Picker data={data} onEmojiSelect={insertEmoji} theme="auto" locale="pt" previewPosition="none" skinTonePosition="search" />
                </PopoverContent>
              </Popover>
              <Popover open={stickerOpen} onOpenChange={setStickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" title="Figurinhas"><Sticker className="h-4 w-4" /></Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="p-0 w-auto">
                  <StickerPicker onPick={(url, name) => void sendStickerUrl(url, name)} />
                </PopoverContent>
              </Popover>
              <Textarea ref={textareaRef} value={text}
                onChange={e => {
                  setText(e.target.value);
                  if (e.target.value.trim().length > 0) sendTyping(true);
                  else sendTyping(false);
                }}
                onBlur={() => sendTyping(false)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTyping(false); void sendText(); } }}
                onPaste={handlePaste}
                placeholder="Digite uma mensagem..." rows={1} className="min-h-10 max-h-32 resize-none" />
              <Button size="icon" onClick={() => void sendText()} disabled={!text.trim() || sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
      </div>

      <Dialog open={!!pendingFile} onOpenChange={(o) => { if (!o) closePendingFile(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar {pendingFile?.type.startsWith('image/') ? 'imagem' : pendingFile?.type.startsWith('video/') ? 'vídeo' : 'arquivo'}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {pendingPreview && pendingFile?.type.startsWith('image/') && (
              <img src={pendingPreview} alt="preview" className="max-h-72 max-w-full rounded-lg object-contain" />
            )}
            {pendingPreview && pendingFile?.type.startsWith('video/') && (
              <video src={pendingPreview} controls className="max-h-72 max-w-full rounded-lg" />
            )}
            {!pendingPreview && pendingFile && (
              <div className="flex items-center gap-2 p-4 border border-border rounded-lg w-full">
                <FileText className="h-6 w-6 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{pendingFile.name}</div>
                  <div className="text-xs text-muted-foreground">{(pendingFile.size / 1024).toFixed(1)} KB</div>
                </div>
              </div>
            )}
            <Textarea
              value={pendingCaption}
              onChange={e => setPendingCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void confirmPendingFile(); } }}
              placeholder="Adicionar uma legenda (opcional)..."
              rows={2}
              className="resize-none"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePendingFile} disabled={sending}>Cancelar</Button>
            <Button onClick={() => void confirmPendingFile()} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Enviar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview de anexo (lightbox in-app) */}
      <Dialog open={!!previewAtt} onOpenChange={(o) => !o && setPreviewAtt(null)}>
        <DialogContent className="max-w-5xl w-[95vw] p-0 bg-background border-border overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              {previewAtt?.kind === 'file' ? <FileText className="h-4 w-4 shrink-0" /> : null}
              <span className="text-sm font-medium truncate">{previewAtt?.name}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => previewAtt && void downloadAttachment(previewAtt.path, previewAtt.name, previewAtt.mime)}>
              <Download className="h-4 w-4 mr-1" /> Baixar
            </Button>
          </div>
          <div className="bg-black/90 flex items-center justify-center min-h-[60vh] max-h-[80vh] overflow-auto">
            {previewAtt?.kind === 'image' && (
              <img src={publicUrl(previewAtt.path)} alt={previewAtt.name} className="max-h-[80vh] max-w-full object-contain" />
            )}
            {previewAtt?.kind === 'file' && previewAtt.mime?.includes('pdf') && (
              <iframe src={publicUrl(previewAtt.path)} title={previewAtt.name} className="w-full h-[80vh] bg-white" />
            )}
            {previewAtt?.kind === 'file' && !previewAtt.mime?.includes('pdf') && (
              <div className="text-center text-white p-8">
                <FileText className="h-16 w-16 mx-auto mb-4 opacity-70" />
                <p className="mb-4 opacity-80">Pré-visualização não disponível para este tipo de arquivo.</p>
                <Button onClick={() => void downloadAttachment(previewAtt.path, previewAtt.name, previewAtt.mime)}>
                  <Download className="h-4 w-4 mr-2" /> Baixar arquivo
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDialog} onOpenChange={(o) => !o && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.kind === 'clear' && 'Limpar conversa?'}
              {confirmDialog?.kind === 'delete' && 'Excluir conversa para você?'}
              {confirmDialog?.kind === 'disband' && 'Desfazer grupo?'}
              {confirmDialog?.kind === 'leave' && 'Sair do grupo?'}
              {confirmDialog?.kind === 'kick' && `Remover ${confirmDialog.userName || 'membro'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.kind === 'clear' && 'Todas as mensagens serão removidas permanentemente para todos os participantes.'}
              {confirmDialog?.kind === 'delete' && 'A conversa será removida apenas da sua lista. A outra pessoa continuará vendo o histórico. Se ela enviar uma nova mensagem, a conversa reaparecerá para você.'}
              {confirmDialog?.kind === 'disband' && 'O grupo será desfeito para todos os participantes e todas as mensagens serão apagadas. Esta ação não pode ser desfeita.'}
              {confirmDialog?.kind === 'leave' && 'Você deixará o grupo e não receberá mais mensagens dele.'}
              {confirmDialog?.kind === 'kick' && 'O participante será removido do grupo e não verá mais novas mensagens.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirmDialog) return;
                if (confirmDialog.kind === 'clear') void clearConv(confirmDialog.convId);
                else if (confirmDialog.kind === 'delete') void deleteConv(confirmDialog.convId);
                else if (confirmDialog.kind === 'disband') void disbandGroup(confirmDialog.convId);
                else if (confirmDialog.kind === 'leave') void leaveGroup(confirmDialog.convId);
                else if (confirmDialog.kind === 'kick' && confirmDialog.userId) void kickMember(confirmDialog.convId, confirmDialog.userId);
                setConfirmDialog(null);
              }}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo: encaminhar mensagem */}
      <Dialog open={!!forwardMsg} onOpenChange={(o) => { if (!o) { setForwardMsg(null); setForwardSelected([]); setForwardSearch(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Encaminhar mensagem</DialogTitle></DialogHeader>
          {forwardMsg && (
            <div className="bg-muted/50 border-l-4 border-primary rounded-md px-3 py-2 mb-2">
              <p className="text-xs text-muted-foreground truncate">{previewMessageText(forwardMsg)}</p>
            </div>
          )}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input autoFocus placeholder="Buscar conversa..." value={forwardSearch} onChange={e => setForwardSearch(e.target.value)} className="pl-8 h-9" />
          </div>
          <ScrollArea className="h-72 border rounded-md p-2">
            {(() => {
              const q = forwardSearch.trim().toLowerCase();
              const list = conversations
                .filter(c => c.id !== forwardMsg?.conversation_id)
                .filter(c => !q || getConvDisplay(c).name.toLowerCase().includes(q));
              if (list.length === 0) return <p className="text-sm text-muted-foreground p-3 text-center">Nenhuma conversa</p>;
              return list.map(c => {
                const d = getConvDisplay(c);
                const checked = forwardSelected.includes(c.id);
                return (
                  <button key={c.id}
                    onClick={() => setForwardSelected(s => checked ? s.filter(x => x !== c.id) : [...s, c.id])}
                    className={cn('flex w-full items-center gap-2 px-2 py-2 rounded-md hover:bg-accent', checked && 'bg-accent')}>
                    <Avatar className="h-8 w-8">
                      {d.avatar ? <AvatarImage src={d.avatar} /> : null}
                      <AvatarFallback>{c.type === 'group' ? <UsersIcon className="h-4 w-4" /> : d.name.charAt(0)?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm flex-1 text-left truncate">{d.name}</span>
                    {checked && <span className="text-xs text-primary">✓</span>}
                  </button>
                );
              });
            })()}
          </ScrollArea>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => { setForwardMsg(null); setForwardSelected([]); setForwardSearch(''); }}>Cancelar</Button>
            <Button disabled={forwardSelected.length === 0} onClick={() => forwardMsg && void forwardMessageTo(forwardMsg, forwardSelected)}>
              Encaminhar {forwardSelected.length > 0 && `(${forwardSelected.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: adicionar membros ao grupo */}
      <Dialog open={addMembersOpen} onOpenChange={setAddMembersOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar membros ao grupo</DialogTitle></DialogHeader>
          {(() => {
            if (!activeConv) return null;
            const currentIds = new Set((participants[activeConv.id] || []).map(p => p.user_id));
            const candidates = members
              .filter(m => !currentIds.has(m.user_id) && m.user_id !== user?.id)
              .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
            const q = addMembersSearch.trim().toLowerCase();
            const filtered = q ? candidates.filter(m => (m.name || '').toLowerCase().includes(q)) : candidates;
            return (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input autoFocus placeholder="Buscar pessoa..." value={addMembersSearch} onChange={e => setAddMembersSearch(e.target.value)} className="pl-8 h-9" />
                </div>
                <ScrollArea className="h-64 border rounded-md p-2">
                  {filtered.map(m => {
                    const checked = addMembersSelected.includes(m.user_id);
                    return (
                      <button key={m.user_id}
                        onClick={() => setAddMembersSelected(s => checked ? s.filter(x => x !== m.user_id) : [...s, m.user_id])}
                        className={cn('flex w-full items-center gap-2 px-2 py-2 rounded-md hover:bg-accent', checked && 'bg-accent')}>
                        <Avatar className="h-8 w-8">
                          {m.avatar_url ? <AvatarImage src={m.avatar_url} /> : null}
                          <AvatarFallback>{m.name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm flex-1 text-left truncate">{m.name}</span>
                        {checked && <span className="text-xs text-primary">✓</span>}
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground p-3 text-center">
                      {candidates.length === 0 ? 'Todos os membros já estão no grupo' : 'Nenhum resultado'}
                    </p>
                  )}
                </ScrollArea>
                <DialogFooter className="mt-3">
                  <Button variant="outline" onClick={() => setAddMembersOpen(false)}>Cancelar</Button>
                  <Button disabled={addMembersSelected.length === 0} onClick={() => void addMembersToGroup(activeConv.id, addMembersSelected)}>
                    Adicionar {addMembersSelected.length > 0 && `(${addMembersSelected.length})`}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Painel lateral: informações e arquivos da conversa */}
      <Sheet open={infoPanelOpen} onOpenChange={setInfoPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-base">{activeConv?.type === 'group' ? 'Informações do grupo' : 'Informações do contato'}</SheetTitle>
            <SheetDescription className="sr-only">Dados, mídia e arquivos compartilhados</SheetDescription>
          </SheetHeader>
          {activeConv && (
            <>
              <div className="px-4 py-4 flex flex-col items-center gap-2 border-b border-border">
                <Avatar className="h-20 w-20">
                  {activeDisplay?.avatar ? <AvatarImage src={activeDisplay.avatar} /> : null}
                  <AvatarFallback className="text-lg">
                    {activeConv.type === 'group' ? <UsersIcon className="h-7 w-7" /> : activeDisplay?.name.charAt(0)?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="text-base font-semibold text-center">{activeDisplay?.name}</p>
                {activeConv.type === 'group' ? (
                  <p className="text-xs text-muted-foreground">
                    {(participants[activeConv.id] || []).length} participantes
                  </p>
                ) : activeDisplay?.subtitle ? (
                  <p className="text-xs text-muted-foreground">{activeDisplay.subtitle}</p>
                ) : null}
              </div>

              {activeConv.type === 'group' && (
                <div className="px-4 py-3 border-b border-border max-h-64 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Participantes ({(participants[activeConv.id] || []).length})
                    </p>
                    {(activeConv.created_by === user?.id || (participants[activeConv.id] || []).find(p => p.user_id === user?.id)?.is_admin) && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                        onClick={() => { setAddMembersSelected([]); setAddMembersSearch(''); setAddMembersOpen(true); }}>
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Adicionar
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {(participants[activeConv.id] || []).map(p => {
                      const m = memberById[p.user_id];
                      if (!m) return null;
                      const isMe = p.user_id === user?.id;
                      const canKick = !isMe && (activeConv.created_by === user?.id || (participants[activeConv.id] || []).find(x => x.user_id === user?.id)?.is_admin);
                      return (
                        <div key={p.user_id} className="flex items-center gap-2 group">
                          <Avatar className="h-7 w-7">
                            {m.avatar_url ? <AvatarImage src={m.avatar_url} /> : null}
                            <AvatarFallback className="text-xs">{m.name.charAt(0)?.toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm truncate flex-1">{m.name}{isMe && <span className="text-muted-foreground"> (você)</span>}</span>
                          {p.is_admin && <span className="text-[10px] text-primary font-semibold">ADMIN</span>}
                          {canKick && (
                            <button
                              type="button"
                              onClick={() => setConfirmDialog({ kind: 'kick', convId: activeConv.id, userId: p.user_id, userName: m.name })}
                              className="opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 p-1 rounded transition-opacity"
                              title="Remover do grupo"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <Tabs value={infoTab} onValueChange={(v) => setInfoTab(v as 'media' | 'docs')} className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mt-3 grid grid-cols-2">
                  <TabsTrigger value="media" className="text-xs"><ImageIcon className="h-3.5 w-3.5 mr-1" />Mídia</TabsTrigger>
                  <TabsTrigger value="docs" className="text-xs"><FileText className="h-3.5 w-3.5 mr-1" />Documentos</TabsTrigger>
                </TabsList>

                <TabsContent value="media" className="flex-1 overflow-hidden mt-3">
                  <ScrollArea className="h-full px-4 pb-4">
                    {(() => {
                      const items = messages.filter(m => !m.deleted_at && (m.type === 'image' || m.type === 'video') && m.attachment_path);
                      if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mídia compartilhada</p>;
                      return (
                        <div className="grid grid-cols-3 gap-1.5">
                          {items.slice().reverse().map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setPreviewAtt({ path: m.attachment_path!, name: m.attachment_name || '', mime: m.attachment_mime || '', kind: m.type as 'image' | 'video' })}
                              className="relative aspect-square rounded-md overflow-hidden bg-muted group"
                            >
                              {m.type === 'image' ? (
                                <img src={publicUrl(m.attachment_path!)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <>
                                  <video src={publicUrl(m.attachment_path!)} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <Film className="h-6 w-6 text-white" />
                                  </div>
                                </>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="docs" className="flex-1 overflow-hidden mt-3">
                  <ScrollArea className="h-full px-4 pb-4">
                    {(() => {
                      const items = messages.filter(m => !m.deleted_at && m.type === 'file' && m.attachment_path);
                      if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento compartilhado</p>;
                      return (
                        <div className="space-y-2">
                          {items.slice().reverse().map(m => {
                            const senderName = memberById[m.sender_id]?.name || 'Usuário';
                            return (
                              <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-md border border-border hover:bg-muted/50 transition-colors">
                                <button
                                  type="button"
                                  onClick={() => setPreviewAtt({ path: m.attachment_path!, name: m.attachment_name || '', mime: m.attachment_mime || '', kind: 'file' })}
                                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                >
                                  <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                    <FileText className="h-5 w-5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{m.attachment_name || 'arquivo'}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {senderName} · {new Date(m.created_at).toLocaleDateString('pt-BR')}
                                    </p>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void downloadAttachment(m.attachment_path!, m.attachment_name || 'arquivo', m.attachment_mime || '')}
                                  className="p-1.5 rounded hover:bg-muted text-muted-foreground shrink-0"
                                  title="Baixar"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

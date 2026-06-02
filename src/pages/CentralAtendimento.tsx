import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { useChatUnread } from '@/hooks/useChatUnread';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { detectSlashAtCursor, filterTemplates, replaceSlashToken } from '@/lib/messages/slash';
import { listTemplates } from '@/lib/messages/templates';
import { substituteVariables } from '@/lib/messages/variables';
import type { MessageTemplate } from '@/lib/messages/types';
import { SlashCommandPopover } from '@/components/atendimento/SlashCommandPopover';
import {
  Send, Search, Plus, Loader2, MessageSquare, User as UserIcon, Tag, Bot,
  CheckCheck, Check, Wifi, WifiOff, RefreshCw, Inbox, Users as UsersIcon, Phone,
  MoreVertical, Trash2, Archive, ArchiveRestore, Eye, UserCog, Eraser,
  CheckCircle2, Paperclip, Download, FileText, AlertCircle,
  FileSpreadsheet, FileArchive, FileCode, File as FileIcon,
  Image as ImageIcon, Film, Music, X,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Chat from '@/pages/Chat';
import ContactsPanel from '@/components/wa/ContactsPanel';
import AudioRecorder from '@/components/wa/AudioRecorder';
import { stripSenderPrefix } from '@/lib/wa-message-format';
import { TypingBubble } from '@/components/chat/TypingBubble';

type ConvStatus = 'novo' | 'em_atendimento' | 'aguardando_cliente' | 'finalizado';
type MsgDirection = 'in' | 'out';
type MsgType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'system';
type MsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
type ProviderKind = 'mock' | 'baileys' | 'meta_cloud' | 'evolution';
type ConnStatus = 'disconnected' | 'connecting' | 'qr_required' | 'qr_pending' | 'connected' | 'error';

interface Contact {
  id: string;
  phone: string;
  name: string;
  avatar_url: string;
  tags: string[];
}
interface Conversation {
  id: string;
  contact_id: string;
  status: ConvStatus;
  assignee_id: string | null;
  tags: string[];
  unread_count: number;
  last_message_preview: string;
  last_message_at: string | null;
  bot_paused: boolean;
  internal_notes: string;
  archived_at: string | null;
  department_id: string | null;
  contact?: Contact;
}
interface Message {
  id: string;
  conversation_id: string;
  direction: MsgDirection;
  type: MsgType;
  body: string;
  status: MsgStatus;
  sender_user_id: string | null;
  created_at: string;
  media_url?: string | null;
  media_mime?: string | null;
  media_name?: string | null;
}
interface ProviderConfig {
  id: string;
  provider: ProviderKind;
  status: ConnStatus;
  status_message: string;
  phone_number: string;
  display_name: string;
}

const STATUS_LABEL: Record<ConvStatus, string> = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando cliente',
  finalizado: 'Finalizado',
};
const STATUS_COLOR: Record<ConvStatus, string> = {
  novo: 'border bg-[hsl(var(--brand-blue)/0.15)] text-[hsl(var(--brand-blue))] border-[hsl(var(--brand-blue)/0.3)] dark:text-[hsl(215_95%_70%)]',
  em_atendimento: 'border bg-warning/15 text-warning border-warning/30',
  aguardando_cliente: 'border bg-[hsl(var(--brand-violet)/0.15)] text-[hsl(var(--brand-violet))] border-[hsl(var(--brand-violet)/0.3)] dark:text-[hsl(268_82%_75%)]',
  finalizado: 'border bg-success/15 text-success border-success/30',
};

function initials(s: string) {
  return s.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}
function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function formatMessageTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatFullDateTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatDayLabel(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7 && diffDays > 0) {
    return d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^./, c => c.toUpperCase());
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function isSameDay(a: string | null, b: string | null) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

type MultiOpt = { value: string; label: string };
function MultiSelectFilter({
  value, onChange, options, placeholder, allLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: MultiOpt[];
  placeholder: string;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (val: string) => {
    if (value.includes(val)) onChange(value.filter(v => v !== val));
    else onChange([...value, val]);
  };
  const summary = value.length === 0
    ? allLabel
    : value.length === 1
      ? (options.find(o => o.value === value[0])?.label ?? value[0])
      : `${value.length} selecionados`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className="truncate text-left">{summary || placeholder}</span>
          <span className="ml-2 shrink-0 opacity-50">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="max-h-64 overflow-y-auto">
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left text-[11px] px-2 py-1 text-primary hover:underline"
            >
              Limpar seleção
            </button>
          )}
          {options.map(opt => {
            const checked = value.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} />
                <span className="truncate">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function CentralAtendimento() {
  const { tenantId } = useTenant();
  const { user, isAdmin, isStaff } = useAuth();
  const chatUnreadCount = useChatUnread();
  const [myDeptId, setMyDeptId] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<'pendentes' | 'meus' | 'resolvidas' | 'todas'>('pendentes');
  // Filtros avançados (admin/supervisor)
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [filterDeptIds, setFilterDeptIds] = useState<string[]>([]); // [] = todos; 'none' inclui sem setor
  const [filterAssigneeIds, setFilterAssigneeIds] = useState<string[]>([]); // [] = todos; 'none' inclui sem atendente
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const ACTIVE_STORAGE_KEY = 'central:lastConversation';
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(ACTIVE_STORAGE_KEY);
  });
  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_STORAGE_KEY, id);
      else localStorage.removeItem(ACTIVE_STORAGE_KEY);
    } catch { /* ignore */ }
    // Optimistically clear the unread badge immediately on click.
    if (id) {
      setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
      void supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', id);
    }
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]); // [] = todos; valores: ConvStatus | 'arquivadas'
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [allTemplates, setAllTemplates] = useState<MessageTemplate[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFiltered, setSlashFiltered] = useState<MessageTemplate[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashContext, setSlashContext] = useState<{ start: number; tokenLen: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('conversas');
  const [members, setMembers] = useState<Array<{ user_id: string; name: string }>>([]);
  const [assigneeNames, setAssigneeNames] = useState<Record<string, string>>({});
  const [transferTarget, setTransferTarget] = useState<Conversation | null>(null);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<'media' | 'docs' | 'audio'>('media');
  const activeIdRef = useRef<string | null>(null);
  const contactsRef = useRef<Record<string, Contact>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const convScrollRef = useRef<HTMLDivElement>(null);
  const messagesFingerprintRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Confirmação de envio de arquivos (paste/anexo/drop) — múltiplos
  type PendingItem = { id: string; file: File; preview: string | null };
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingCaption, setPendingCaption] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Typing presence per WhatsApp contact phone -> { state, ts }
  const [typingByPhone, setTypingByPhone] = useState<Record<string, { state: string; ts: number }>>({});

  // Load provider config + conversations
  // Em modo "silent" (polling de fallback) NÃO recarrega o provider_config (raramente muda
  // e custa um round-trip extra a cada poll).
  const loadAll = async (opts?: { silent?: boolean }) => {
    if (!tenantId) return;
    if (!opts?.silent) setLoading(true);

    const convPromise = supabase.from('wa_conversations').select('*').eq('tenant_id', tenantId).order('last_message_at', { ascending: false, nullsFirst: false });
    const contactsPromise = supabase.from('wa_contacts').select('*').eq('tenant_id', tenantId);
    const provPromise = opts?.silent
      ? null
      : supabase.from('wa_provider_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    const [convRes, contactsRes, provRes] = await Promise.all([
      convPromise,
      contactsPromise,
      provPromise as any,
    ]);


    if (provRes && provRes.data) {
      setProvider(provRes.data as any);
    } else if (provRes && !provRes.error) {
      // Auto-create a mock provider config
      const { data: created } = await supabase
        .from('wa_provider_config')
        .insert({ tenant_id: tenantId, provider: 'mock', status: 'connected', status_message: 'Modo Mock ativo', display_name: 'Mock WhatsApp' })
        .select('*')
        .maybeSingle();
      if (created) setProvider(created as any);
    }

    const cMap: Record<string, Contact> = {};
    (contactsRes.data || []).forEach((c: any) => { cMap[c.id] = c; });
    setContacts(cMap);

    const convs: Conversation[] = (convRes.data || []).map((c: any) => ({ ...c, contact: cMap[c.contact_id] }));
    setConversations(convs);
    // Mantém a última conversa aberta se ainda existir; caso contrário, nada selecionado.
    if (activeIdRef.current && !convs.find(c => c.id === activeIdRef.current)) {
      setActiveId(null);
    }
    if (!opts?.silent) setLoading(false);
  };

  const loadMessages = async (conversationId: string, opts?: { markRead?: boolean }) => {
    const { data } = await supabase
      .from('wa_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (activeIdRef.current !== conversationId) return;

    const rows = (data || []) as Message[];
    const fingerprint = rows.map(m => `${m.id}:${m.status}:${m.created_at}:${m.body}`).join('|');
    if (messagesFingerprintRef.current !== fingerprint) {
      messagesFingerprintRef.current = fingerprint;
      setMessages(rows);
    }

    if (opts?.markRead !== false) {
      await supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', conversationId);
    }
  };

  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [tenantId]);

  // Load message templates for the slash command
  useEffect(() => {
    if (!tenantId) return;
    listTemplates(tenantId).then(setAllTemplates).catch(() => {});
  }, [tenantId]);

  // Load tenant members for transfer
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data: tm } = await supabase
        .from('tenant_members')
        .select('user_id')
        .eq('tenant_id', tenantId);
      const ids = (tm || []).map((r: any) => r.user_id);
      if (ids.length === 0) { setMembers([]); return; }
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, name, username')
        .in('user_id', ids);
      setMembers((profs || []).map((p: any) => ({
        user_id: p.user_id,
        name: p.name || p.username || 'Usuário',
      })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, [tenantId]);

  // Resolve assignee names that aren't in members list (e.g. deactivated users)
  useEffect(() => {
    const knownIds = new Set([
      ...members.map(m => m.user_id),
      ...Object.keys(assigneeNames),
    ]);
    const missing = Array.from(new Set(
      conversations.map(c => c.assignee_id).filter((id): id is string => !!id && !knownIds.has(id))
    ));
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, name, username')
        .in('user_id', missing);
      if (!data || data.length === 0) return;
      setAssigneeNames(prev => {
        const next = { ...prev };
        for (const p of data as any[]) {
          next[p.user_id] = p.name || p.username || 'Usuário';
        }
        return next;
      });
    })();
  }, [conversations, members, assigneeNames]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  // Realtime: conversations + messages (incremental updates, no full reload)
  useEffect(() => {
    if (!tenantId) return;
    const upsertConversation = async (raw: any) => {
      let contact = contactsRef.current[raw.contact_id];
      if (!contact) {
        const { data } = await supabase
          .from('wa_contacts')
          .select('*')
          .eq('id', raw.contact_id)
          .maybeSingle();
        if (data) {
          contact = data as Contact;
          setContacts(prev => ({ ...prev, [contact.id]: contact }));
        }
      }

      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === raw.id);
        const merged = { ...(idx >= 0 ? prev[idx] : {}), ...raw, contact } as Conversation;
        const next = idx >= 0 ? [...prev] : [merged, ...prev];
        if (idx >= 0) next[idx] = merged;
        next.sort((a, b) => {
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return tb - ta;
        });
        return next;
      });
    };

    const ch = supabase
      .channel(`wa-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deleted = payload.old as any;
            setConversations(prev => prev.filter(c => c.id !== deleted.id));
            if (activeIdRef.current === deleted.id) setActiveId(null);
            return;
          }
          void upsertConversation(payload.new as any);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contacts', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const c = payload.old as any;
            setContacts(prev => {
              const next = { ...prev };
              delete next[c.id];
              return next;
            });
            return;
          }
          const c = payload.new as Contact;
          setContacts(prev => ({ ...prev, [c.id]: c }));
          setConversations(prev => prev.map(conv => conv.contact_id === c.id ? { ...conv, contact: c } : conv));
        })
      // OBS: mensagens da conversa ativa são atualizadas pelo canal específico
      // `wa-active-messages-...` abaixo. Não duplicamos aqui para evitar setState repetido
      // (a cada mensagem recebida o React faria 2 atualizações idênticas).
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadAll({ silent: true });
      });

    // Realtime já cobre conversations/contacts/messages; o polling serve apenas como rede de
    // segurança caso o websocket caia. 60s é suficiente.
    const interval = setInterval(() => { void loadAll({ silent: true }); }, 60000);
    return () => {
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line
  }, [tenantId]);

  // Subscribe to typing/recording presence broadcast from wa-webhook
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`wa-typing-${tenantId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'presence' }, (msg: any) => {
        const phone = String(msg?.payload?.phone || '').replace(/\D/g, '');
        const state = String(msg?.payload?.state || '');
        if (!phone) return;
        setTypingByPhone(prev => {
          if (state === 'composing' || state === 'recording') {
            return { ...prev, [phone]: { state, ts: Date.now() } };
          }
          if (!prev[phone]) return prev;
          const next = { ...prev };
          delete next[phone];
          return next;
        });
      })
      .subscribe();
    // expire stale entries (>8s without refresh)
    const interval = setInterval(() => {
      setTypingByPhone(prev => {
        const now = Date.now();
        let changed = false;
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts < 8000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => {
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [tenantId]);

  // Load messages when active changes
  useEffect(() => {
    messagesFingerprintRef.current = '';
    if (!activeId) { setMessages([]); return; }
    void loadMessages(activeId);
  }, [activeId]);

  // Subscribe to WhatsApp presence (typing/recording) for the active contact.
  // Evolution/Baileys requires explicit presenceSubscribe per JID, refreshed periodically.
  useEffect(() => {
    if (!tenantId || !activeId || !provider || provider.provider !== 'evolution') return;
    const conv = conversations.find(c => c.id === activeId);
    const phone = conv?.contact?.phone ? String(conv.contact.phone).replace(/\D/g, '') : '';
    if (!phone) return;
    const subscribe = () => {
      void supabase.functions.invoke('wa-evolution', {
        body: { action: 'subscribe_presence', tenant_id: tenantId, phone },
      }).catch(() => { /* silent */ });
    };
    subscribe();
    const interval = setInterval(subscribe, 25000);
    return () => clearInterval(interval);
  }, [tenantId, activeId, provider, conversations]);

  // Realtime específico da conversa aberta + polling curto como fallback.
  useEffect(() => {
    if (!tenantId || !activeId) return;

    const ch = supabase
      .channel(`wa-active-messages-${tenantId}-${activeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const changed = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Message;
          // Realtime UPDATE may omit unchanged columns. The channel filter already restricts to this conversation,
          // so only reject when conversation_id is present AND differs.
          if (changed?.conversation_id && changed.conversation_id !== activeIdRef.current) return;

          setMessages(prev => {
            const next = payload.eventType === 'DELETE'
              ? prev.filter(m => m.id !== changed.id)
              : (() => {
                  const idx = prev.findIndex(m => m.id === changed.id);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = { ...copy[idx], ...changed };
                    return copy;
                  }
                  return [...prev, changed];
                })();
            const sorted = [...next].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            messagesFingerprintRef.current = sorted.map(m => `${m.id}:${m.status}:${m.created_at}:${m.body}`).join('|');
            return sorted;
          });

          void supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', activeId);
          // Não chamamos loadAll aqui — o canal de wa_conversations atualiza last_message_at/unread sozinho.
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadMessages(activeId);
      });

    // Fallback longo — realtime já entrega as mensagens em tempo real.
    const interval = setInterval(() => { void loadMessages(activeId, { markRead: false }); }, 60000);
    return () => {
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line
  }, [tenantId, activeId]);

  // Auto-scroll inteligente: ao trocar de conversa, sempre vai pro fim.
  // Em novas mensagens, só rola se o usuário já está perto do fim (>120px) — assim
  // ler histórico não é interrompido.
  const lastConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messages.length) return;
    const el = messagesScrollRef.current;
    const isNewConv = lastConvIdRef.current !== activeId;
    lastConvIdRef.current = activeId;
    const nearBottom = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    if (!isNewConv && !nearBottom) return;
    try {
      messagesVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    } catch {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages.length, activeId]);

  // ESC desfaz a seleção da conversa atual
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !activeId) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (t?.isContentEditable ?? false);
      if (isTyping) return;
      setActiveId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  const active = conversations.find(c => c.id === activeId) || null;

  // Carregar setor do usuário logado (para fila do setor)
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('department_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) setMyDeptId(data?.department_id || null);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Carregar lista de setores do tenant (para filtros avançados de staff)
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void supabase
      .from('departments')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setDepartments((data as any) || []);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Resolvidas (status='finalizado') somem da lista após 00:00 (horário de Brasília, UTC-3).
  // Pendentes e em-atendimento permanecem inalteradas.
  const brasiliaMidnightMs = (now = Date.now()) => {
    const offsetMs = 3 * 60 * 60 * 1000; // BRT = UTC-3
    const d = new Date(now - offsetMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() + offsetMs;
  };
  const [todayCutoffMs, setTodayCutoffMs] = useState(() => brasiliaMidnightMs());
  useEffect(() => {
    const tick = () => setTodayCutoffMs(brasiliaMidnightMs());
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);
  const isStaleResolved = (c: Conversation) => {
    if (c.status !== 'finalizado') return false;
    const t = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    return t < todayCutoffMs;
  };

  // Contadores das filas (para exibir no menu de tabs).
  // Conversas que ainda estão em fluxo do bot (sem setor e sem atendente) NÃO aparecem
  // — só entram na fila depois do handoff (manual, do bot, ou por timeout de inatividade).
  // Admin/Supervisor (isStaff): vê tudo, sem restrição de setor.
  const counts = useMemo(() => {
    let pendentes = 0, meus = 0, resolvidas = 0, todas = 0;
    for (const c of conversations) {
      if (c.archived_at) continue;
      if (isStaleResolved(c)) continue;
      // Oculta conversas que ainda estão totalmente com o bot
      if (!c.assignee_id && !c.department_id) continue;
      const isMine = !!user?.id && c.assignee_id === user.id;
      const inMyDept = !!myDeptId && c.department_id === myDeptId;
      const visible = isStaff || isMine || inMyDept;
      if (!visible) continue;
      todas++;
      if (c.status === 'finalizado') {
        resolvidas++;
        continue;
      }
      if (isMine) meus++;
      // Pendentes: staff vê todas sem dono; usuário comum só do seu setor
      const isPending = !c.assignee_id || c.status === 'novo';
      if (isPending && (isStaff || inMyDept)) pendentes++;
    }
    return { pendentes, meus, resolvidas, todas };
  }, [conversations, user?.id, myDeptId, isStaff, todayCutoffMs]);

  const filtered = useMemo(() => {
    return conversations.filter(c => {
      const isArchived = !!c.archived_at;
      const allowArchived = filterStatuses.includes('arquivadas');
      const statusSet = filterStatuses.filter(s => s !== 'arquivadas');
      if (isArchived) {
        if (!allowArchived) return false;
      } else {
        if (statusSet.length > 0 && !statusSet.includes(c.status)) return false;
      }

      // Resolvidas de dias anteriores são limpas após 00:00 (Brasília)
      if (isStaleResolved(c)) return false;
      // Conversas em fluxo do bot (sem setor e sem atendente) ficam ocultas
      // até o handoff acontecer (manual, do bot, ou por timeout).
      if (!c.assignee_id && !c.department_id) return false;

      const isMine = !!user?.id && c.assignee_id === user.id;
      const inMyDept = !!myDeptId && c.department_id === myDeptId;

      // Filtro por fila
      if (queueTab === 'pendentes') {
        if (c.status === 'finalizado') return false;
        const isPending = !c.assignee_id || c.status === 'novo';
        if (!isPending) return false;
        // Staff vê pendentes de todos os setores; usuário comum só do seu setor
        if (!isStaff && !inMyDept) return false;
      } else if (queueTab === 'meus') {
        if (!isMine || c.status === 'finalizado') return false;
      } else if (queueTab === 'resolvidas') {
        if (c.status !== 'finalizado') return false;
        // Usuário comum só vê resolvidas que ele atendeu OU do seu setor
        if (!isStaff && !isMine && !inMyDept) return false;
      } else if (queueTab === 'todas') {
        // Aba só disponível para staff
        if (!isStaff) return false;
      }

      // Filtros avançados (visíveis para staff) — multi-seleção
      if (isStaff) {
        if (filterDeptIds.length > 0) {
          const allowNoneDept = filterDeptIds.includes('none');
          const deptIds = filterDeptIds.filter(x => x !== 'none');
          const matches =
            (allowNoneDept && !c.department_id) ||
            (!!c.department_id && deptIds.includes(c.department_id));
          if (!matches) return false;
        }
        if (filterAssigneeIds.length > 0) {
          const allowNoneAssignee = filterAssigneeIds.includes('none');
          const assigneeIds = filterAssigneeIds.filter(x => x !== 'none');
          const matches =
            (allowNoneAssignee && !c.assignee_id) ||
            (!!c.assignee_id && assigneeIds.includes(c.assignee_id));
          if (!matches) return false;
        }
      }

      // Hide empty conversations (no real message exchanged) unless searching
      if (!search && !c.last_message_at && !c.last_message_preview) return false;
      if (search) {
        const term = search.toLowerCase();
        const name = (c.contact?.name || '').toLowerCase();
        const phone = (c.contact?.phone || '').toLowerCase();
        if (!name.includes(term) && !phone.includes(term)) return false;
      }
      return true;
    });
  }, [conversations, filterStatuses, search, queueTab, user?.id, myDeptId, isStaff, filterDeptIds, filterAssigneeIds, todayCutoffMs]);

  // Virtualização da lista de conversas
  const convVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => convScrollRef.current,
    estimateSize: () => 84,
    overscan: 8,
  });

  // Virtualização da lista de mensagens
  const messagesVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: () => 72,
    overscan: 12,
  });

  const archiveConv = async (conv: Conversation) => {
    const archive = !conv.archived_at;
    const { error } = await supabase
      .from('wa_conversations')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', conv.id);
    if (error) { toast.error(error.message); return; }
    toast.success(archive ? 'Conversa arquivada' : 'Conversa restaurada');
    if (activeId === conv.id) setActiveId(null);
  };

  const deleteConv = async (conv: Conversation) => {
    if (!confirm(`Excluir definitivamente a conversa com ${conv.contact?.name || conv.contact?.phone || 'este contato'}? Esta ação não pode ser desfeita.`)) return;
    // Delete messages first (FK cascade is on, but we ensure)
    await supabase.from('wa_messages').delete().eq('conversation_id', conv.id);
    const { error } = await supabase.from('wa_conversations').delete().eq('id', conv.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Conversa excluída');
    if (activeId === conv.id) setActiveId(null);
    setConversations(prev => prev.filter(c => c.id !== conv.id));
  };

  const clearConv = async (conv: Conversation) => {
    if (!confirm(`Limpar todas as mensagens da conversa com ${conv.contact?.name || conv.contact?.phone || 'este contato'}? A conversa em si será mantida.`)) return;
    const { error } = await supabase.from('wa_messages').delete().eq('conversation_id', conv.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from('wa_conversations').update({
      last_message_preview: '', last_message_at: null, unread_count: 0,
    }).eq('id', conv.id);
    if (activeId === conv.id) {
      messagesFingerprintRef.current = '';
      setMessages([]);
    }
    toast.success('Mensagens removidas');
  };

  const transferConv = async (conv: Conversation, userId: string) => {
    if (conv.assignee_id === userId) {
      toast.info('Esta conversa já está atribuída a este atendente');
      return;
    }
    const target = members.find(m => m.user_id === userId);
    const fromName = conv.assignee_id
      ? (members.find(m => m.user_id === conv.assignee_id)?.name || assigneeNames[conv.assignee_id] || 'atendente anterior')
      : 'fila';
    const toName = target?.name || 'usuário';
    const byName = user?.name || user?.username || 'sistema';

    const { error } = await supabase
      .from('wa_conversations')
      .update({ assignee_id: userId, status: conv.status === 'novo' ? 'em_atendimento' : conv.status })
      .eq('id', conv.id);
    if (error) { toast.error(error.message); return; }

    // Registra evento de transferência no histórico
    await supabase.from('wa_messages').insert({
      tenant_id: tenantId,
      conversation_id: conv.id,
      contact_id: conv.contact_id,
      direction: 'out',
      type: 'system',
      body: `🔄 Conversa transferida de ${fromName} para ${toName}${byName !== fromName ? ` por ${byName}` : ''}`,
      status: 'sent',
      sender_user_id: user?.id || null,
    });

    toast.success(`Conversa transferida para ${toName}`);
    setTransferTarget(null);
  };

  const viewLive = (conv: Conversation) => {
    setActiveId(conv.id);
    setActiveTab('conversas');
  };

  const send = async () => {
    if (!draft.trim() || !active || !user || !tenantId) return;
    setSending(true);
    const body = draft.trim();
    setDraft('');
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const contact = contacts[active.contact_id];
      const phone = contact?.phone || '';

      // Prefixa nome do atendente — salvamos com o mesmo body que vai pro WhatsApp,
      // para o dedup do webhook (que compara body) reconhecer o echo e não duplicar.
      const senderName = (user.name || user.username || '').trim();
      const outboundText = senderName ? `*${senderName}:* ${body}` : body;

      // Optimistic UI: mostra a mensagem instantaneamente, antes da resposta do servidor
      const optimistic: Message = {
        id: tempId,
        tenant_id: tenantId,
        conversation_id: active.id,
        contact_id: active.contact_id,
        direction: 'out',
        type: 'text',
        body: outboundText,
        status: 'pending',
        sender_user_id: user.id,
        created_at: new Date().toISOString(),
      } as Message;
      setMessages(prev => [...prev, optimistic]);

      // Insert outgoing message
      const { data: inserted, error } = await supabase.from('wa_messages').insert({
        tenant_id: tenantId,
        conversation_id: active.id,
        contact_id: active.contact_id,
        direction: 'out',
        type: 'text',
        body: outboundText,
        status: provider?.provider === 'evolution' ? 'pending' : 'sent',
        sender_user_id: user.id,
      }).select('id').maybeSingle();
      if (error) throw error;
      if (!inserted?.id) throw new Error('Não foi possível registrar a mensagem (verifique permissões).');

      // Substitui o tempId pelo id real (evita duplicar quando o realtime chegar)
      if (inserted?.id) {
        setMessages(prev => {
          const hasReal = prev.some(m => m.id === inserted.id);
          if (hasReal) return prev.filter(m => m.id !== tempId);
          return prev.map(m => m.id === tempId ? { ...m, id: inserted.id } : m);
        });
      }

      await supabase.from('wa_conversations').update({
        last_message_preview: body,
        last_message_at: new Date().toISOString(),
        status: active.status === 'novo' ? 'em_atendimento' : active.status,
        assignee_id: active.assignee_id || user.id,
      }).eq('id', active.id);

      // Send via Evolution or Meta Cloud API
      if ((provider?.provider === 'evolution' || provider?.provider === 'meta_cloud') && phone) {
        const fnName = provider.provider === 'meta_cloud' ? 'wa-meta' : 'wa-evolution';
        const { data: sendRes, error: sendErr } = await supabase.functions.invoke(fnName, {
          body: { action: 'send', tenant_id: tenantId, phone, text: outboundText },
        });
        if (sendErr || (sendRes as any)?.error) {
          await supabase.from('wa_messages').update({ status: 'failed' }).eq('id', inserted!.id);
          throw new Error((sendErr as any)?.message || (sendRes as any)?.error || 'Falha no envio');
        }
        await supabase.from('wa_messages').update({
          status: 'sent',
          external_id: (sendRes as any)?.externalId || '',
        }).eq('id', inserted!.id);
      }

      // Mock auto-reply
      if (provider?.provider === 'mock') {
        setTimeout(async () => {
          await supabase.from('wa_messages').insert({
            tenant_id: tenantId,
            conversation_id: active.id,
            contact_id: active.contact_id,
            direction: 'in',
            type: 'text',
            body: `[Mock] Recebi sua mensagem: "${body.slice(0, 60)}"`,
            status: 'delivered',
            sender_user_id: null,
          });
          await supabase.from('wa_conversations').update({
            last_message_preview: `[Mock] Resposta automática`,
            last_message_at: new Date().toISOString(),
            unread_count: 1,
          }).eq('id', active.id);
        }, 1500);
      }
    } catch (e: any) {
      // Remove placeholder otimista em caso de falha
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast.error('Erro ao enviar: ' + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const sendMedia = async (
    file: Blob | File,
    mediaType: 'audio' | 'image' | 'video' | 'document',
    fileName: string,
    mimeType: string,
    caption?: string,
  ) => {
    if (!active || !tenantId || !user) return;
    const contact = contacts[active.contact_id];
    const phone = contact?.phone || '';
    setSending(true);
    try {
      // Upload to storage
      const ext = (() => {
        if (fileName.includes('.')) return fileName.split('.').pop();
        if (mimeType.includes('webm')) return 'webm';
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('mp4')) return 'mp4';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
        if (mimeType.includes('png')) return 'png';
        if (mimeType.includes('pdf')) return 'pdf';
        return 'bin';
      })();
      const safeName = fileName.replace(/[^\w.\-]/g, '_') || `arquivo.${ext}`;
      const path = `wa-${mediaType}/${tenantId}/${active.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { contentType: mimeType, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path);
      const mediaUrl = pub.publicUrl;

      // Insert outgoing message
      const captionTrim = (caption || '').trim();
      const previewText = captionTrim
        ? captionTrim
        : mediaType === 'audio' ? '🎤 Áudio'
        : mediaType === 'image' ? '🖼️ Imagem'
        : mediaType === 'video' ? '🎬 Vídeo'
        : `📎 ${safeName}`;

      const { data: inserted, error } = await supabase.from('wa_messages').insert({
        tenant_id: tenantId,
        conversation_id: active.id,
        contact_id: active.contact_id,
        direction: 'out',
        type: mediaType,
        body: previewText,
        media_url: mediaUrl,
        media_mime: mimeType,
        media_name: safeName,
        status: provider?.provider === 'evolution' ? 'pending' : 'sent',
        sender_user_id: user.id,
      }).select('id').maybeSingle();
      if (error) throw error;
      if (!inserted?.id) throw new Error('Não foi possível registrar a mídia (verifique permissões).');
      await supabase.from('wa_conversations').update({
        last_message_preview: previewText,
        last_message_at: new Date().toISOString(),
        status: active.status === 'novo' ? 'em_atendimento' : active.status,
        assignee_id: active.assignee_id || user.id,
      }).eq('id', active.id);

      if ((provider?.provider === 'evolution' || provider?.provider === 'meta_cloud') && phone) {
        const fnName = provider.provider === 'meta_cloud' ? 'wa-meta' : 'wa-evolution';
        const senderName = (user?.name || user?.username || '').trim();
        const baseCaption = senderName ? `*${senderName}:*` : '';
        const finalCaption = captionTrim
          ? (baseCaption ? `${baseCaption} ${captionTrim}` : captionTrim)
          : baseCaption;
        const { data: sendRes, error: sendErr } = await supabase.functions.invoke(fnName, {
          body: {
            action: 'send_media',
            tenant_id: tenantId,
            phone,
            media_url: mediaUrl,
            media_type: mediaType,
            file_name: safeName,
            caption: finalCaption,
          },
        });
        if (sendErr || (sendRes as any)?.error) {
          await supabase.from('wa_messages').update({ status: 'failed' }).eq('id', inserted!.id);
          throw new Error((sendErr as any)?.message || (sendRes as any)?.error || 'Falha no envio');
        }
        await supabase.from('wa_messages').update({
          status: 'sent',
          external_id: (sendRes as any)?.externalId || '',
        }).eq('id', inserted!.id);
      }
    } catch (e: any) {
      toast.error('Erro ao enviar mídia: ' + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const sendAudio = async (blob: Blob, mimeType: string) => {
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    await sendMedia(blob, 'audio', `audio-${Date.now()}.${ext}`, mimeType);
  };

  const makePendingItem = (file: File): PendingItem => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    preview: (file.type.startsWith('image/') || file.type.startsWith('video/'))
      ? URL.createObjectURL(file)
      : null,
  });

  const addPendingFiles = (files: File[]) => {
    if (files.length === 0) return;
    setPendingItems(prev => {
      const next = [...prev];
      for (const f of files) next.push(makePendingItem(f));
      return next;
    });
  };

  const removePendingItem = (id: string) => {
    setPendingItems(prev => {
      const target = prev.find(p => p.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter(p => p.id !== id);
    });
  };

  const closePendingFile = () => {
    setPendingItems(prev => {
      for (const p of prev) if (p.preview) URL.revokeObjectURL(p.preview);
      return [];
    });
    setPendingCaption('');
  };

  const confirmPendingFile = async () => {
    if (pendingItems.length === 0) return;
    const items = pendingItems;
    const caption = pendingCaption;
    setPendingItems([]);
    setPendingCaption('');
    for (let i = 0; i < items.length; i++) {
      const { file, preview } = items[i];
      if (preview) URL.revokeObjectURL(preview);
      const mime = file.type || '';
      let kind: 'image' | 'video' | 'document' = 'document';
      if (mime.startsWith('image/')) kind = 'image';
      else if (mime.startsWith('video/')) kind = 'video';
      const cap = i === 0 ? caption : '';
      await sendMedia(file, kind, file.name || `arquivo-${Date.now()}`, mime || 'application/octet-stream', cap);
    }
  };

  const handleFilePick = (files: File[] | File) => {
    const arr = Array.isArray(files) ? files : [files];
    addPendingFiles(arr);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!active) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addPendingFiles(files);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!active) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!active) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addPendingFiles(files);
  };

  const resolveConv = async () => {
    if (!active) return;
    await supabase.from('wa_conversations').update({
      status: 'finalizado',
      unread_count: 0,
      last_message_preview: '✅ Atendimento finalizado',
      last_message_at: new Date().toISOString(),
    }).eq('id', active.id);
    await supabase.from('wa_messages').insert({
      tenant_id: tenantId,
      conversation_id: active.id,
      contact_id: active.contact_id,
      direction: 'out',
      type: 'system',
      body: `✅ Atendimento finalizado por ${user?.name || user?.username || 'atendente'}`,
      status: 'sent',
      sender_user_id: user?.id || null,
    });
    toast.success('Conversa marcada como resolvida');
  };

  const updateStatus = async (st: ConvStatus) => {
    if (!active) return;
    if (st === active.status) return;
    // Marcar como Finalizado pelo dropdown deve seguir o mesmo fluxo do botão "Resolver"
    // (limpa unread, registra log no histórico). Evita inconsistência entre as duas vias.
    if (st === 'finalizado') {
      await resolveConv();
      return;
    }
    // Se está saindo de "finalizado" para outro status, registra reabertura
    const wasResolved = active.status === 'finalizado';
    const { error } = await supabase.from('wa_conversations').update({ status: st }).eq('id', active.id);
    if (error) { toast.error(error.message); return; }
    if (wasResolved) {
      await supabase.from('wa_messages').insert({
        tenant_id: tenantId,
        conversation_id: active.id,
        contact_id: active.contact_id,
        direction: 'out',
        type: 'system',
        body: `🔁 Atendimento reaberto por ${user?.name || user?.username || 'atendente'}`,
        status: 'sent',
        sender_user_id: user?.id || null,
      });
    }
    toast.success('Status atualizado');
  };

  const assignToMe = async () => {
    if (!active || !user) return;
    // Se a conversa estava finalizada, reabre como "em_atendimento" + log de auditoria
    const wasResolved = active.status === 'finalizado';
    const patch: { assignee_id: string; status?: ConvStatus } = { assignee_id: user.id };
    if (wasResolved) patch.status = 'em_atendimento';
    const { error } = await supabase.from('wa_conversations').update(patch).eq('id', active.id);
    if (error) { toast.error(error.message); return; }
    if (wasResolved) {
      await supabase.from('wa_messages').insert({
        tenant_id: tenantId,
        conversation_id: active.id,
        contact_id: active.contact_id,
        direction: 'out',
        type: 'system',
        body: `🔁 Atendimento reaberto por ${user?.name || user?.username || 'atendente'}`,
        status: 'sent',
        sender_user_id: user?.id || null,
      });
    }
    toast.success(wasResolved ? 'Atendimento reaberto e atribuído a você' : 'Conversa atribuída a você');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="-m-8 h-[calc(100dvh-60px)] flex flex-col overflow-hidden bg-background">
      {/* Top bar with tabs + actions */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-3 min-w-max">
            <h2 className="text-base font-bold tracking-tight shrink-0">Central</h2>
            <TabsList className="h-9">
              <TabsTrigger value="conversas" className="text-xs">
                <Inbox className="h-3.5 w-3.5 mr-1.5" /> Clientes
                {(() => {
                  const waUnread = conversations
                    .filter(c => c.status !== 'finalizado' && !c.archived_at && c.id !== activeId)
                    .reduce((acc, c) => acc + (c.unread_count || 0), 0);
                  return waUnread > 0 ? (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
                      {waUnread > 99 ? '99+' : waUnread}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="contatos" className="text-xs"><Phone className="h-3.5 w-3.5 mr-1.5" /> Contatos</TabsTrigger>
              <TabsTrigger value="interno" className="text-xs">
                <UsersIcon className="h-3.5 w-3.5 mr-1.5" /> Chat Interno
                {chatUnreadCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex items-center gap-2">
            <ProviderBadge provider={provider} />
            {activeTab === 'conversas' && (
              <>
                <NewConversationDialog
                  open={showNewConv}
                  onOpenChange={setShowNewConv}
                  tenantId={tenantId}
                  onCreated={(id) => { setActiveId(id); void loadAll(); }}
                />
                <Button size="sm" onClick={() => setShowNewConv(true)} className="h-8">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Nova
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => loadAll()} title="Atualizar">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        <TabsContent value="interno" className="flex-1 m-0 min-h-0 overflow-hidden">
          <Chat embedded />
        </TabsContent>

        <TabsContent value="contatos" className="flex-1 m-0 min-h-0 overflow-auto p-4">
          <ContactsPanel
            onOpenConversation={async (contactId) => {
              await loadAll();
              const conv = conversations.find(c => c.contact_id === contactId);
              if (conv) setActiveId(conv.id);
              else {
                const { data } = await supabase
                  .from('wa_conversations')
                  .select('id')
                  .eq('tenant_id', tenantId!)
                  .eq('contact_id', contactId)
                  .order('last_message_at', { ascending: false, nullsFirst: false })
                  .limit(1).maybeSingle();
                if (data) setActiveId(data.id);
                await loadAll();
              }
              setActiveTab('conversas');
            }}
          />
        </TabsContent>

        <TabsContent value="conversas" className="flex-1 m-0 min-h-0 overflow-hidden">
      <div className="flex h-full w-full min-w-0 overflow-hidden">
        {/* Conv list */}
        <div className="w-full md:w-[300px] lg:w-[320px] xl:w-[340px] shrink-0 border-r border-border bg-card overflow-hidden flex flex-col min-h-0 min-w-0">
          <div className="p-3 space-y-2 border-b border-border">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="pl-9 h-9" />
            </div>

            {/* Filas */}
            <div className={cn('grid gap-1 rounded-md bg-muted/50 p-1 min-w-0', isStaff ? 'grid-cols-4' : 'grid-cols-3')}>
              <button
                type="button"
                onClick={() => setQueueTab('pendentes')}
                className={cn(
                  'min-w-0 text-[11px] font-medium py-1.5 px-1 rounded transition-colors flex items-center justify-center gap-1 overflow-hidden',
                  queueTab === 'pendentes' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                title={isStaff ? 'Aguardando atendimento (todos os setores)' : 'Aguardando atendimento no seu setor'}
              >
                <span className="truncate">Pendentes</span>
                {counts.pendentes > 0 && (
                  <span className="shrink-0 text-[9px] bg-warning text-warning-foreground rounded-full px-1.5 py-0 leading-tight">{counts.pendentes}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setQueueTab('meus')}
                className={cn(
                  'min-w-0 text-[11px] font-medium py-1.5 px-1 rounded transition-colors flex items-center justify-center gap-1 overflow-hidden',
                  queueTab === 'meus' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                title="Conversas atribuídas a você"
              >
                <span className="truncate">Em atend.</span>
                {counts.meus > 0 && (
                  <span className="shrink-0 text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 py-0 leading-tight">{counts.meus}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setQueueTab('resolvidas')}
                className={cn(
                  'min-w-0 text-[11px] font-medium py-1.5 px-1 rounded transition-colors flex items-center justify-center gap-1 overflow-hidden',
                  queueTab === 'resolvidas' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                title="Conversas finalizadas"
              >
                <span className="truncate">Resolvidas</span>
                {counts.resolvidas > 0 && (
                  <span className="shrink-0 text-[9px] bg-success text-success-foreground rounded-full px-1.5 py-0 leading-tight">{counts.resolvidas}</span>
                )}
              </button>
              {isStaff && (
                <button
                  type="button"
                  onClick={() => setQueueTab('todas')}
                  className={cn(
                    'min-w-0 text-[11px] font-medium py-1.5 px-1 rounded transition-colors flex items-center justify-center gap-1 overflow-hidden',
                    queueTab === 'todas' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Todas as conversas (admin/supervisor)"
                >
                  <span className="truncate">Todas</span>
                  {counts.todas > 0 && (
                    <span className="shrink-0 text-[9px] bg-muted-foreground/20 text-foreground rounded-full px-1.5 py-0 leading-tight">{counts.todas}</span>
                  )}
                </button>
              )}
            </div>

            <MultiSelectFilter
              value={filterStatuses}
              onChange={setFilterStatuses}
              placeholder="Status"
              allLabel="Todos status"
              options={[
                { value: 'novo', label: 'Novas' },
                { value: 'em_atendimento', label: 'Em atendimento' },
                { value: 'aguardando_cliente', label: 'Aguardando cliente' },
                { value: 'finalizado', label: 'Finalizadas' },
                ...(isAdmin ? [{ value: 'arquivadas', label: 'Arquivadas' }] : []),
              ]}
            />

            {/* Filtros avançados — só para admin/supervisor */}
            {isStaff && (
              <div className="grid grid-cols-2 gap-1.5">
                <MultiSelectFilter
                  value={filterDeptIds}
                  onChange={setFilterDeptIds}
                  placeholder="Setor"
                  allLabel="Todos setores"
                  options={[
                    { value: 'none', label: 'Sem setor' },
                    ...departments.map(d => ({ value: d.id, label: d.name })),
                  ]}
                />
                <MultiSelectFilter
                  value={filterAssigneeIds}
                  onChange={setFilterAssigneeIds}
                  placeholder="Atendente"
                  allLabel="Todos atendentes"
                  options={[
                    { value: 'none', label: 'Sem atendente' },
                    ...members.map(m => ({ value: m.user_id, label: m.name })),
                  ]}
                />
              </div>
            )}

            {(filterDeptIds.length > 0 || filterAssigneeIds.length > 0 || filterStatuses.length > 0) && isStaff && (
              <button
                type="button"
                onClick={() => { setFilterDeptIds([]); setFilterAssigneeIds([]); setFilterStatuses([]); }}
                className="text-[10px] text-primary hover:underline self-start"
              >
                Limpar filtros
              </button>
            )}

            {queueTab === 'pendentes' && !myDeptId && !isStaff && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                Você não está vinculado a um setor. Peça ao administrador.
              </p>
            )}
          </div>
          <div ref={convScrollRef} className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Nenhuma conversa
              </div>
            ) : (
              <div
                style={{
                  height: convVirtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                }}
              >
                {convVirtualizer.getVirtualItems().map(vi => {
                  const c = filtered[vi.index];
                  if (!c) return null;
                  return (
                    <div
                      key={c.id}
                      ref={convVirtualizer.measureElement}
                      data-index={vi.index}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className={cn(
                              'group relative flex items-start gap-3 px-3 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer',
                              activeId === c.id && 'bg-muted'
                            )}
                            onClick={() => setActiveId(c.id)}
                          >
                            <Avatar className="h-10 w-10 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {initials(c.contact?.name || c.contact?.phone || '?')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium truncate">{c.contact?.name || c.contact?.phone || 'Sem nome'}</p>
                                <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(c.last_message_at)}</span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{c.last_message_preview || 'Sem mensagens'}</p>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                <Badge variant="outline" className={cn('text-[9px] py-0 h-4 border max-w-full truncate', STATUS_COLOR[c.status])}>
                                  {STATUS_LABEL[c.status]}
                                </Badge>
                                {c.unread_count > 0 && (
                                  <Badge className="text-[9px] h-4 py-0 bg-primary shrink-0">{c.unread_count}</Badge>
                                )}
                                {c.archived_at && (
                                  <Badge variant="outline" className="text-[9px] h-4 py-0 shrink-0">Arquivada</Badge>
                                )}
                                {c.assignee_id && (
                                  <Badge variant="outline" className="text-[9px] h-4 py-0 max-w-[100px] truncate">
                                    {members.find(m => m.user_id === c.assignee_id)?.name || 'atribuída'}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={() => viewLive(c)}>
                                  <Eye className="h-4 w-4 mr-2" /> Visualizar em tempo real
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setTransferTarget(c)}>
                                  <UserCog className="h-4 w-4 mr-2" /> Transferir atendimento
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => archiveConv(c)}>
                                  {c.archived_at ? (
                                    <><ArchiveRestore className="h-4 w-4 mr-2" /> Restaurar</>
                                  ) : (
                                    <><Archive className="h-4 w-4 mr-2" /> Arquivar (mantém histórico)</>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => clearConv(c)}>
                                  <Eraser className="h-4 w-4 mr-2" /> Limpar mensagens
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => deleteConv(c)} className="text-destructive focus:text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" /> Excluir conversa
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-56">
                          <ContextMenuItem onClick={() => viewLive(c)}>
                            <Eye className="h-4 w-4 mr-2" /> Visualizar em tempo real
                          </ContextMenuItem>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <UserCog className="h-4 w-4 mr-2" /> Transferir para...
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent className="w-56 max-h-72 overflow-y-auto">
                              {members.length === 0 ? (
                                <ContextMenuItem disabled>Nenhum membro disponível</ContextMenuItem>
                              ) : members.map(m => (
                                <ContextMenuItem key={m.user_id} onClick={() => transferConv(c, m.user_id)}>
                                  <UserIcon className="h-4 w-4 mr-2" />
                                  {m.name}
                                  {c.assignee_id === m.user_id && <Check className="h-3 w-3 ml-auto" />}
                                </ContextMenuItem>
                              ))}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuItem onClick={() => archiveConv(c)}>
                            {c.archived_at ? (
                              <><ArchiveRestore className="h-4 w-4 mr-2" /> Restaurar</>
                            ) : (
                              <><Archive className="h-4 w-4 mr-2" /> Arquivar (mantém histórico)</>
                            )}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => clearConv(c)}>
                            <Eraser className="h-4 w-4 mr-2" /> Limpar mensagens
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => deleteConv(c)} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" /> Excluir conversa
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 bg-card flex flex-col overflow-hidden min-h-0 min-w-0">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 flex-wrap min-w-0">
                <button
                  type="button"
                  onClick={() => { setMediaTab('media'); setMediaPanelOpen(true); }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-md hover:bg-muted/50 transition-colors px-1 py-0.5 -mx-1"
                  title="Ver informações e arquivos do contato"
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {initials(active.contact?.name || active.contact?.phone || '?')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate hover:underline">{active.contact?.name || 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {active.contact?.phone}
                      {active.assignee_id && (
                        <>
                          {' · '}
                          <span className="text-primary font-medium">
                            Atendente: {members.find(m => m.user_id === active.assignee_id)?.name || assigneeNames[active.assignee_id] || 'carregando...'}
                          </span>
                        </>
                      )}
                      {!active.assignee_id && (
                        <span className="text-muted-foreground/70"> · Sem atendente</span>
                      )}
                    </p>
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs shrink-0 px-2"
                  onClick={() => setTransferTarget(active)}
                  title="Transferir atendimento para outro usuário"
                >
                  <UserCog className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Transferir</span>
                </Button>
                {active.status !== 'finalizado' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0 px-2 border-success/40 text-success hover:bg-success/10 hover:text-success"
                    onClick={resolveConv}
                    title="Marcar atendimento como resolvido"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Resolver</span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0 px-2 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                    onClick={assignToMe}
                    title="Reabrir e atribuir este atendimento a mim"
                  >
                    <UserIcon className="h-3.5 w-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Reabrir Chamado</span>
                  </Button>
                )}
                <Select value={active.status} onValueChange={v => updateStatus(v as ConvStatus)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div
                ref={messagesScrollRef}
                className="flex-1 overflow-y-auto px-6 py-5 bg-muted/30 relative"
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragging && (
                  <div className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-primary">
                      <Paperclip className="h-8 w-8" />
                      <p className="text-sm font-semibold">Solte para anexar e enviar</p>
                    </div>
                  </div>
                )}
                <div
                  className="max-w-5xl mx-auto relative"
                  style={{ height: messagesVirtualizer.getTotalSize(), width: '100%' }}
                >
                  {messagesVirtualizer.getVirtualItems().map(vi => {
                    const m = messages[vi.index];
                    if (!m) return null;
                    const prev = vi.index > 0 ? messages[vi.index - 1] : null;
                    const sameSender = !!prev
                      && prev.direction === m.direction
                      && (prev.sender_user_id || null) === (m.sender_user_id || null);
                    let senderName: string | null = null;
                    if (m.direction === 'out' && m.type !== 'system' && !sameSender) {
                      if (m.sender_user_id) {
                        senderName = members.find(mm => mm.user_id === m.sender_user_id)?.name
                          || assigneeNames[m.sender_user_id]
                          || 'Atendente';
                      } else {
                        senderName = 'Bot';
                      }
                    }
                    return (
                      <div
                        key={m.id}
                        ref={messagesVirtualizer.measureElement}
                        data-index={vi.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vi.start}px)`,
                          paddingBottom: '0.75rem',
                        }}
                       >
                        {(!prev || !isSameDay(prev.created_at, m.created_at)) && (
                          <div className="flex justify-center my-2">
                            <div className="text-[11px] px-3 py-1 rounded-full bg-background/80 backdrop-blur text-muted-foreground border border-border shadow-sm font-medium">
                              {formatDayLabel(m.created_at)}
                            </div>
                          </div>
                        )}
                        <MessageBubble m={m} senderName={senderName} />
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} style={{ position: 'absolute', top: messagesVirtualizer.getTotalSize(), height: 1, width: 1 }} />
                </div>
                {(() => {
                  const phone = active?.contact?.phone ? String(active.contact.phone).replace(/\D/g, '') : '';
                  const t = phone ? typingByPhone[phone] : null;
                  if (!t) return null;
                  return (
                    <div className="max-w-5xl mx-auto pt-2 pb-1">
                      <TypingBubble
                        name={active?.contact?.name?.split(' ')[0] || undefined}
                        recording={t.state === 'recording'}
                        align="left"
                      />
                    </div>
                  );
                })()}
              </div>

              <div
                className="p-3 border-t border-border bg-background"
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                  onChange={(e) => {
                    const arr = Array.from(e.target.files || []);
                    if (arr.length) handleFilePick(arr);
                    e.target.value = '';
                  }}
                />
                <div className="flex items-end gap-2 relative">
                  <SlashCommandPopover
                    open={slashOpen}
                    templates={slashFiltered}
                    activeIndex={slashIndex}
                    setActiveIndex={setSlashIndex}
                    onSelect={(t) => {
                      if (!slashContext) return;
                      const contact = active ? contacts[active.contact_id] : undefined;
                      const sub = substituteVariables(t.content, {
                        contact: { name: contact?.name, phone: contact?.phone },
                        user: { name: user?.name || user?.username },
                      });
                      const r = replaceSlashToken(draft, slashContext.start, slashContext.tokenLen, sub.output);
                      setDraft(r.text);
                      setSlashOpen(false);
                      setSlashContext(null);
                      setTimeout(() => {
                        const ta = draftRef.current; if (!ta) return;
                        ta.focus();
                        ta.setSelectionRange(r.cursor, r.cursor);
                      }, 0);
                      if (sub.missing.length) {
                        toast.warning(`Preencha as variáveis: ${sub.missing.map(v => `{${v}}`).join(', ')}`);
                      }
                    }}
                    onClose={() => setSlashOpen(false)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    title="Anexar arquivo"
                    disabled={sending}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 w-10 shrink-0"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <AudioRecorder onSend={sendAudio} disabled={sending} />
                  <Textarea
                    ref={draftRef}
                    value={draft}
                    onChange={e => {
                      const v = e.target.value;
                      setDraft(v);
                      const cursor = e.target.selectionStart ?? v.length;
                      const m = detectSlashAtCursor(v, cursor);
                      if (m) {
                        const list = filterTemplates(allTemplates, m.token, 'whatsapp');
                        setSlashFiltered(list);
                        setSlashContext({ start: m.start, tokenLen: m.token.length });
                        setSlashIndex(0);
                        setSlashOpen(true);
                      } else {
                        setSlashOpen(false);
                        setSlashContext(null);
                      }
                    }}
                    onKeyDown={e => {
                      if (slashOpen && slashFiltered.length) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashFiltered.length - 1)); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const t = slashFiltered[slashIndex];
                          if (t && slashContext) {
                            const contact = active ? contacts[active.contact_id] : undefined;
                            const sub = substituteVariables(t.content, {
                              contact: { name: contact?.name, phone: contact?.phone },
                              user: { name: user?.name || user?.username },
                            });
                            const r = replaceSlashToken(draft, slashContext.start, slashContext.tokenLen, sub.output);
                            setDraft(r.text);
                            setSlashOpen(false);
                            setSlashContext(null);
                            setTimeout(() => {
                              const ta = draftRef.current; if (!ta) return;
                              ta.focus(); ta.setSelectionRange(r.cursor, r.cursor);
                            }, 0);
                          }
                          return;
                        }
                        if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                    }}
                    onPaste={handlePaste}
                    placeholder='Digite "/" para mensagens prontas. Cole (Ctrl+V) para enviar arquivos. Enter envia, Shift+Enter quebra linha.'
                    rows={2}
                    className="resize-none"
                    disabled={sending}
                  />

                  <Button onClick={send} disabled={sending || !draft.trim()} size="icon" className="h-10 w-10 shrink-0">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Side panel */}
        <div className="hidden lg:flex w-[280px] xl:w-[320px] shrink-0 border-l border-border bg-card overflow-hidden flex-col min-h-0 min-w-0">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">—</div>
          ) : (
            <ContactPanel
              conversation={active}
              onAssignMe={assignToMe}
              onRefresh={loadAll}
            />
          )}
        </div>
      </div>
        </TabsContent>

      </Tabs>

      <Dialog open={pendingItems.length > 0} onOpenChange={(o) => { if (!o) closePendingFile(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Enviar {pendingItems.length} {pendingItems.length === 1 ? 'arquivo' : 'arquivos'} para {active?.contact?.name || active?.contact?.phone || 'contato'}?
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 max-h-[320px] overflow-y-auto pr-1">
              {pendingItems.map((it) => {
                const isImg = it.file.type.startsWith('image/');
                const isVid = it.file.type.startsWith('video/');
                return (
                  <div key={it.id} className="relative group border border-border rounded-lg overflow-hidden bg-muted/40 aspect-square">
                    {isImg && it.preview ? (
                      <img src={it.preview} alt={it.file.name} className="w-full h-full object-cover" />
                    ) : isVid && it.preview ? (
                      <video src={it.preview} className="w-full h-full object-cover" muted />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
                        <FileText className="h-8 w-8 text-muted-foreground mb-1" />
                        <div className="text-[10px] font-medium truncate w-full">{it.file.name}</div>
                        <div className="text-[10px] text-muted-foreground">{(it.file.size / 1024).toFixed(0)} KB</div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingItem(it.id)}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground border border-border flex items-center justify-center transition-colors"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {(isImg || isVid) && (
                      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-background/80 text-[10px] truncate">
                        {it.file.name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="self-start"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Adicionar mais
            </Button>
            <Textarea
              value={pendingCaption}
              onChange={e => setPendingCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void confirmPendingFile(); } }}
              placeholder={pendingItems.length > 1 ? 'Legenda (vai com o primeiro item)...' : 'Adicionar uma legenda (opcional)...'}
              rows={2}
              className="resize-none"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePendingFile} disabled={sending}>Cancelar</Button>
            <Button onClick={() => void confirmPendingFile()} disabled={sending || pendingItems.length === 0}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Enviar {pendingItems.length > 1 ? `(${pendingItems.length})` : ''}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!transferTarget} onOpenChange={(o) => !o && setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir atendimento</DialogTitle>
          </DialogHeader>
          {transferTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecione para quem transferir a conversa com{' '}
                <strong>{transferTarget.contact?.name || transferTarget.contact?.phone || 'este contato'}</strong>.
              </p>
              <div className="border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-border">
                {members.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Nenhum membro disponível</div>
                ) : members.map(m => (
                  <button
                    key={m.user_id}
                    onClick={() => transferConv(transferTarget, m.user_id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-[10px]">{initials(m.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      {transferTarget.assignee_id === m.user_id && (
                        <p className="text-[10px] text-muted-foreground">Atribuído atualmente</p>
                      )}
                    </div>
                    {transferTarget.assignee_id === m.user_id && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferTarget(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Painel lateral: informações do contato + histórico de arquivos */}
      <Sheet open={mediaPanelOpen} onOpenChange={setMediaPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-base">Informações do contato</SheetTitle>
            <SheetDescription className="sr-only">Dados, mídia e arquivos compartilhados</SheetDescription>
          </SheetHeader>
          {active && (
            <>
              <div className="px-4 py-4 flex flex-col items-center gap-2 border-b border-border">
                <Avatar className="h-20 w-20">
                  <AvatarFallback className="bg-primary/10 text-primary text-lg">
                    {initials(active.contact?.name || active.contact?.phone || '?')}
                  </AvatarFallback>
                </Avatar>
                <p className="text-base font-semibold text-center">{active.contact?.name || 'Sem nome'}</p>
                {active.contact?.phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />{active.contact.phone}
                  </p>
                )}
              </div>
              <Tabs value={mediaTab} onValueChange={(v) => setMediaTab(v as 'media' | 'docs' | 'audio')} className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mt-3 grid grid-cols-3">
                  <TabsTrigger value="media" className="text-xs"><ImageIcon className="h-3.5 w-3.5 mr-1" />Mídia</TabsTrigger>
                  <TabsTrigger value="docs" className="text-xs"><FileText className="h-3.5 w-3.5 mr-1" />Docs</TabsTrigger>
                  <TabsTrigger value="audio" className="text-xs"><Music className="h-3.5 w-3.5 mr-1" />Áudio</TabsTrigger>
                </TabsList>

                <TabsContent value="media" className="flex-1 overflow-hidden mt-3">
                  <ScrollArea className="h-full px-4 pb-4">
                    {(() => {
                      const items = messages.filter(m => (m.type === 'image' || m.type === 'video') && m.media_url);
                      if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mídia compartilhada</p>;
                      return (
                        <div className="grid grid-cols-3 gap-1.5">
                          {items.slice().reverse().map(m => (
                            <a key={m.id} href={m.media_url} target="_blank" rel="noreferrer" className="relative aspect-square rounded-md overflow-hidden bg-muted group">
                              {m.type === 'image' ? (
                                <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <>
                                  <video src={m.media_url} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <Film className="h-6 w-6 text-white" />
                                  </div>
                                </>
                              )}
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="docs" className="flex-1 overflow-hidden mt-3">
                  <ScrollArea className="h-full px-4 pb-4">
                    {(() => {
                      const items = messages.filter(m => m.type === 'document' && m.media_url);
                      if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento compartilhado</p>;
                      return (
                        <div className="space-y-2">
                          {items.slice().reverse().map(m => (
                            <a key={m.id} href={m.media_url} target="_blank" rel="noreferrer" download={m.media_name || undefined}
                              className="flex items-center gap-3 p-2.5 rounded-md border border-border hover:bg-muted/50 transition-colors">
                              <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                <FileText className="h-5 w-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{m.media_name || 'documento'}</p>
                                <p className="text-xs text-muted-foreground">{formatTime(m.created_at)} · {m.direction === 'in' ? 'Recebido' : 'Enviado'}</p>
                              </div>
                              <Download className="h-4 w-4 text-muted-foreground shrink-0" />
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="audio" className="flex-1 overflow-hidden mt-3">
                  <ScrollArea className="h-full px-4 pb-4">
                    {(() => {
                      const items = messages.filter(m => m.type === 'audio' && m.media_url);
                      if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Nenhum áudio compartilhado</p>;
                      return (
                        <div className="space-y-2">
                          {items.slice().reverse().map(m => (
                            <div key={m.id} className="p-2.5 rounded-md border border-border space-y-1.5">
                              <p className="text-xs text-muted-foreground">{formatTime(m.created_at)} · {m.direction === 'in' ? 'Recebido' : 'Enviado'}</p>
                              <audio controls src={m.media_url} className="w-full" />
                            </div>
                          ))}
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

export function ConnectionPanel({ provider, tenantId, onSaved }: {
  provider: ProviderConfig | null; tenantId: string | null;
  onSaved: (p: ProviderConfig) => void;
}) {
  const [providerKind, setProviderKind] = useState<ProviderKind>(provider?.provider || 'evolution');
  const [displayName, setDisplayName] = useState(provider?.display_name || '');
  const [phoneNumber, setPhoneNumber] = useState(provider?.phone_number || '');
  const [evoApiUrl, setEvoApiUrl] = useState((provider as any)?.evolution_api_url || '');
  const [evoApiKey, setEvoApiKey] = useState((provider as any)?.evolution_api_key || '');
  const [evoInstance, setEvoInstance] = useState((provider as any)?.evolution_instance_name || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string>((provider as any)?.qr_code || '');
  const [pollTick, setPollTick] = useState(0);
  const [connectMethod, setConnectMethod] = useState<'qr' | 'pairing'>('qr');
  const [pairingPhone, setPairingPhone] = useState<string>(provider?.phone_number || '');
  const [pairingCode, setPairingCode] = useState<string>('');
  // Meta Cloud API
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState<string>((provider as any)?.meta_phone_number_id || '');
  const [metaAccessToken, setMetaAccessToken] = useState<string>((provider as any)?.meta_access_token || '');
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [verifyingMeta, setVerifyingMeta] = useState(false);

  useEffect(() => {
    if (provider) {
      setProviderKind(provider.provider);
      setDisplayName(provider.display_name);
      setPhoneNumber(provider.phone_number);
      setEvoApiUrl((provider as any)?.evolution_api_url || '');
      setEvoApiKey((provider as any)?.evolution_api_key || '');
      setEvoInstance((provider as any)?.evolution_instance_name || '');
      setQrCode((provider as any)?.qr_code || '');
      setMetaPhoneNumberId((provider as any)?.meta_phone_number_id || '');
      setMetaAccessToken((provider as any)?.meta_access_token || '');
    }
  }, [provider]);

  const saveCredentials = async () => {
    if (!tenantId) return;
    setSavingCreds(true);
    try {
      const payload: any = {
        evolution_api_url: evoApiUrl.trim().replace(/\/+$/, ''),
        evolution_api_key: evoApiKey.trim(),
      };
      if (evoInstance.trim()) payload.evolution_instance_name = evoInstance.trim();
      const { data, error } = await supabase
        .from('wa_provider_config').update(payload).eq('tenant_id', tenantId)
        .select('*').maybeSingle();
      if (error) throw error;
      if (data) onSaved(data as any);
      toast.success('Credenciais Evolution salvas');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    } finally { setSavingCreds(false); }
  };

  // Polling de status (a cada 3s) enquanto não estiver conectado
  useEffect(() => {
    if (providerKind !== 'evolution' || !tenantId) return;
    if (provider?.status === 'connected') return;
    const id = setInterval(async () => {
      try {
        const { data } = await supabase.functions.invoke('wa-evolution', {
          body: { action: 'status', tenant_id: tenantId },
        });
        // Refresh provider from DB
        const { data: cfg } = await supabase
          .from('wa_provider_config').select('*').eq('tenant_id', tenantId).maybeSingle();
        if (cfg) {
          onSaved(cfg as any);
          setQrCode((cfg as any).qr_code || '');
        }
        setPollTick(t => t + 1);
      } catch { /* noop */ }
    }, 3500);
    return () => clearInterval(id);
  }, [providerKind, tenantId, provider?.status]);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const payload: any = {
        provider: providerKind,
        display_name: displayName,
        phone_number: phoneNumber,
      };
      if (providerKind === 'mock') {
        payload.status = 'connected';
        payload.status_message = 'Modo Mock ativo';
      }
      const { data, error } = await supabase
        .from('wa_provider_config').update(payload).eq('tenant_id', tenantId)
        .select('*').maybeSingle();
      if (error) throw error;
      if (data) onSaved(data as any);
      toast.success('Configuração salva');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    } finally { setSaving(false); }
  };

  const handleConnect = async () => {
    if (!tenantId) return;
    if (connectMethod === 'pairing') {
      const digits = pairingPhone.replace(/\D/g, '');
      if (digits.length < 10) {
        toast.error('Informe o número completo com DDI e DDD (ex.: 5511999999999)');
        return;
      }
    }
    setConnecting(true);
    setQrCode('');
    setPairingCode('');
    try {
      const { data, error } = await supabase.functions.invoke('wa-evolution', {
        body: {
          action: 'connect',
          tenant_id: tenantId,
          mode: connectMethod,
          phone: connectMethod === 'pairing' ? pairingPhone.replace(/\D/g, '') : undefined,
        },
      });
      if (error) throw error;
      const qr = (data as any)?.qr || '';
      const code = (data as any)?.pairingCode || '';
      if (qr) setQrCode(qr);
      if (code) setPairingCode(code);
      if (!qr && !code && (data as any)?.error) throw new Error((data as any).error);
      const { data: cfg } = await supabase
        .from('wa_provider_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (cfg) onSaved(cfg as any);
      if (code) toast.success(`Código gerado: ${code}`);
      else if (qr) toast.success('Pronto! Escaneie o QR Code com seu WhatsApp');
      else toast.info('Conexão iniciada. Aguardando resposta da Evolution API.');
    } catch (e: any) {
      toast.error('Erro ao conectar: ' + (e?.message || e));
    } finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    if (!tenantId) return;
    if (!confirm('Desconectar o WhatsApp? Você precisará escanear o QR Code novamente.')) return;
    try {
      await supabase.functions.invoke('wa-evolution', {
        body: { action: 'disconnect', tenant_id: tenantId },
      });
      const { data: cfg } = await supabase
        .from('wa_provider_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (cfg) onSaved(cfg as any);
      setQrCode('');
      toast.success('Desconectado');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    }
  };

  const handleRestart = async () => {
    if (!tenantId) return;
    try {
      await supabase.functions.invoke('wa-evolution', {
        body: { action: 'restart', tenant_id: tenantId },
      });
      toast.success('Instância reiniciada');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    }
  };

  const webhookUrl = provider && tenantId
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-webhook/${tenantId}?secret=${(provider as any).webhook_secret || ''}`
    : '';

  const isEvolution = providerKind === 'evolution';
  const isMeta = providerKind === 'meta_cloud';
  const status = provider?.status;

  const saveMeta = async () => {
    if (!tenantId) return;
    setSavingMeta(true);
    try {
      const { data, error } = await supabase
        .from('wa_provider_config').update({
          meta_phone_number_id: metaPhoneNumberId.trim(),
          meta_access_token: metaAccessToken.trim(),
        }).eq('tenant_id', tenantId)
        .select('*').maybeSingle();
      if (error) throw error;
      if (data) onSaved(data as any);
      toast.success('Credenciais Meta salvas');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    } finally { setSavingMeta(false); }
  };

  const verifyMeta = async () => {
    if (!tenantId) return;
    setVerifyingMeta(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-meta', {
        body: { action: 'verify', tenant_id: tenantId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const { data: cfg } = await supabase
        .from('wa_provider_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (cfg) onSaved(cfg as any);
      toast.success(`Conectado: ${(data as any)?.display_phone_number || (data as any)?.verified_name || 'Meta API ok'}`);
    } catch (e: any) {
      toast.error('Falha na verificação: ' + (e?.message || e));
    } finally { setVerifyingMeta(false); }
  };


  return (
    <div className="max-w-2xl space-y-4">
      <div className="border border-border rounded-xl bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Provedor WhatsApp</h3>
          <p className="text-xs text-muted-foreground">Escolha como conectar ao WhatsApp.</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Provider</label>
          <Select value={providerKind} onValueChange={v => setProviderKind(v as ProviderKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="evolution">Evolution API — recomendado (auto-hospedado)</SelectItem>
              <SelectItem value="meta_cloud">Meta WhatsApp Cloud API — oficial</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            {providerKind === 'evolution' && 'Conexão real via QR Code. Funciona com seu WhatsApp normal.'}
            {providerKind === 'meta_cloud' && 'API oficial da Meta. Sem risco de banimento, custo por mensagem.'}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Nome de exibição</label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Atendimento" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Número WhatsApp</label>
            <Input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+55 11 99999-9999" />
          </div>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar configuração'}
        </Button>
      </div>

      {isEvolution && (
        <div className="border border-border rounded-xl bg-card p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Credenciais Evolution API</h3>
            <p className="text-xs text-muted-foreground">
              Use sua própria instância Evolution. Se deixar em branco, será usada a instância padrão da plataforma (não recomendado para produção).
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">URL da Evolution API</label>
              <Input
                value={evoApiUrl}
                onChange={e => setEvoApiUrl(e.target.value)}
                placeholder="https://evolution.seudominio.com.br"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key (apikey)</label>
              <div className="flex gap-2">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={evoApiKey}
                  onChange={e => setEvoApiKey(e.target.value)}
                  placeholder="••••••••••••••••"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setShowApiKey(s => !s)}>
                  {showApiKey ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nome da Instância (opcional)</label>
              <Input
                value={evoInstance}
                onChange={e => setEvoInstance(e.target.value)}
                placeholder="ex.: minha-empresa"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Se vazio, será gerado automaticamente. Mude apenas se você já tem uma instância criada na sua Evolution.
              </p>
            </div>
          </div>
          <Button onClick={saveCredentials} disabled={savingCreds} variant="default">
            {savingCreds ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar credenciais'}
          </Button>
        </div>
      )}

      {isEvolution && (
        <div className="border border-border rounded-xl bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Conexão WhatsApp (Evolution)</h3>
            <ProviderBadge provider={provider} />
          </div>
          <p className="text-xs text-muted-foreground">{provider?.status_message || 'Pronto para conectar'}</p>

          {status !== 'connected' && (
            <div className="flex flex-col gap-4 py-4">
              {/* Seletor de método — sempre visível */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Método de conexão</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setConnectMethod('qr'); setPairingCode(''); }}
                    className={cn(
                      'border rounded-lg p-3 text-left text-xs transition-colors',
                      connectMethod === 'qr' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                    )}
                  >
                    <div className="font-semibold mb-0.5">QR Code</div>
                    <div className="text-muted-foreground">Escaneie pelo celular</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConnectMethod('pairing'); setQrCode(''); }}
                    className={cn(
                      'border rounded-lg p-3 text-left text-xs transition-colors',
                      connectMethod === 'pairing' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                    )}
                  >
                    <div className="font-semibold mb-0.5">Número de telefone</div>
                    <div className="text-muted-foreground">Receba um código de 8 dígitos (celular ou fixo Business)</div>
                  </button>
                </div>
              </div>

              {/* Conteúdo do método selecionado */}
              {connectMethod === 'qr' && qrCode ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-lg border border-border">
                    <img
                      src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code"
                      className="w-64 h-64"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    Abra o <strong>WhatsApp</strong> no celular → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong> e escaneie o código acima.
                  </p>
                  <p className="text-[10px] text-muted-foreground">Atualizando automaticamente...</p>
                </div>
              ) : connectMethod === 'pairing' && pairingCode ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white dark:bg-muted p-4 rounded-lg border border-border text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Código de pareamento</p>
                    <p className="text-3xl font-mono font-bold tracking-[0.4em]">
                      {pairingCode.replace(/(.{4})/, '$1 ').trim()}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    Abra o <strong>WhatsApp</strong> no telefone <strong>{pairingPhone}</strong> → <strong>Aparelhos conectados</strong> → <strong>Conectar com número de telefone</strong> e digite o código acima.
                  </p>
                  <p className="text-[10px] text-muted-foreground">O código expira em alguns minutos. Atualizando status automaticamente...</p>
                </div>
              ) : (
                <>
                  {connectMethod === 'pairing' && (
                    <div>
                      <label className="text-xs text-muted-foreground">Número com DDI + DDD (somente dígitos)</label>
                      <Input
                        value={pairingPhone}
                        onChange={e => setPairingPhone(e.target.value)}
                        placeholder="5511999999999"
                        inputMode="numeric"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Funciona com qualquer número WhatsApp (celular ou fixo registrado no WhatsApp Business). O código aparecerá aqui e você o digita no app do WhatsApp em <strong>Aparelhos conectados → Conectar com número de telefone</strong>.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col items-center gap-2 pt-2">
                    {status === 'connecting' && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                    <Button onClick={handleConnect} disabled={connecting} size="lg">
                      {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
                      {connectMethod === 'qr' ? 'Gerar QR Code' : 'Gerar código de pareamento'}
                    </Button>
                    {status === 'error' && (
                      <p className="text-xs text-destructive text-center max-w-sm">A conexão falhou. Tente novamente ou reinicie a instância.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {status === 'connected' && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
              <Wifi className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">WhatsApp conectado!</p>
              <p className="text-xs text-muted-foreground mt-1">Pronto para enviar e receber mensagens.</p>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-border">
            {status === 'connected' ? (
              <Button onClick={handleDisconnect} variant="outline" size="sm">
                <WifiOff className="h-3.5 w-3.5 mr-1.5" /> Desconectar
              </Button>
            ) : (
              <Button onClick={handleConnect} variant="outline" size="sm" disabled={connecting}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', connecting && 'animate-spin')} /> Gerar novo QR
              </Button>
            )}
            <Button onClick={handleRestart} variant="ghost" size="sm">
              Reiniciar instância
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground bg-warning/10 border border-warning/20 rounded p-2">
            ⚠️ <strong>Importante:</strong> não use o WhatsApp Web no mesmo número, senão derruba a sessão.
          </div>
        </div>
      )}

      {isMeta && (
        <div className="border border-border rounded-xl bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Credenciais Meta WhatsApp Cloud API</h3>
            <ProviderBadge provider={provider} />
          </div>
          <p className="text-xs text-muted-foreground">
            Cada empresa configura seu próprio app na Meta. Acesse o <strong>Meta for Developers</strong>, crie um app
            com o produto <strong>WhatsApp</strong> e copie os dados abaixo.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Phone Number ID</label>
              <Input
                value={metaPhoneNumberId}
                onChange={e => setMetaPhoneNumberId(e.target.value)}
                placeholder="ex.: 123456789012345"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Encontrado em WhatsApp → API Setup, abaixo do número de teste/produção.
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Access Token (permanente)</label>
              <div className="flex gap-2">
                <Input
                  type={showMetaToken ? 'text' : 'password'}
                  value={metaAccessToken}
                  onChange={e => setMetaAccessToken(e.target.value)}
                  placeholder="EAAG..."
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setShowMetaToken(s => !s)}>
                  {showMetaToken ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Gere um token <strong>System User permanente</strong> com permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>. Tokens temporários expiram em 24h.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveMeta} disabled={savingMeta}>
              {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar credenciais'}
            </Button>
            <Button onClick={verifyMeta} variant="outline" disabled={verifyingMeta || !metaAccessToken || !metaPhoneNumberId}>
              {verifyingMeta ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
              Testar conexão
            </Button>
          </div>
          {provider?.status === 'connected' && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-xs">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">Meta API conectada — {provider.phone_number || provider.display_name}</p>
            </div>
          )}
          {provider?.status === 'error' && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
              {provider.status_message}
            </div>
          )}
        </div>
      )}

      {isMeta && webhookUrl && (
        <div className="border border-border rounded-xl bg-card p-5 space-y-3">
          <h3 className="font-semibold">Webhook (Meta)</h3>
          <p className="text-xs text-muted-foreground">
            No painel da Meta, vá em <strong>WhatsApp → Configuration → Webhook</strong> e cole:
          </p>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Callback URL</label>
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Verify Token</label>
            <Input readOnly value={(provider as any)?.webhook_secret || ''} className="font-mono text-xs" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Após verificar, inscreva-se no campo <code>messages</code> para receber mensagens dos clientes.
          </p>
        </div>
      )}

      {provider && !isEvolution && !isMeta && (
        <div className="border border-border rounded-xl bg-card p-5 space-y-3">
          <h3 className="font-semibold">Status da conexão</h3>
          <div className="flex items-center gap-2">
            <ProviderBadge provider={provider} />
            <span className="text-xs text-muted-foreground">{provider.status_message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function getFileExt(name: string, mime?: string | null) {
  const fromName = name?.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (fromName) return fromName;
  if (mime) {
    const m = mime.split('/')[1] || '';
    return m.split(';')[0].toLowerCase();
  }
  return '';
}

function getDocIcon(ext: string) {
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'xml', 'py', 'java'].includes(ext)) return FileCode;
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return FileText;
  return FileIcon;
}

function getDocColor(ext: string) {
  if (ext === 'pdf') return 'bg-destructive';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'bg-success';
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return 'bg-[hsl(var(--brand-blue))]';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'bg-warning';
  return 'bg-muted-foreground';
}

function DocumentAttachment({
  url, fileName, mime, out,
}: { url: string; fileName: string; mime?: string | null; out: boolean }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);

  const ext = getFileExt(fileName, mime);
  const Icon = getDocIcon(ext);
  const color = getDocColor(ext);
  const displayName = fileName || `arquivo${ext ? '.' + ext : ''}`;

  // Try to peek at size via HEAD (best-effort, ignore errors)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(url, { method: 'HEAD' });
        const len = r.headers.get('content-length');
        if (!cancelled && len) setSize(parseInt(len, 10));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const handleDownload = async () => {
    if (downloading) return;
    setError(null);
    setDownloading(true);
    setProgress(0);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            if (total) setProgress(Math.round((received / total) * 100));
          }
        }
      }

      const blob = reader
        ? new Blob(chunks as BlobPart[], { type: mime || 'application/octet-stream' })
        : await response.blob();

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = displayName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setProgress(100);
      toast.success('Download concluído');
    } catch (e: any) {
      console.error('[download] failed', e);
      setError(e?.message || 'Falha no download');
      toast.error('Não foi possível baixar o arquivo');
    } finally {
      setDownloading(false);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  const surface = out
    ? 'bg-primary-foreground/10 border-primary-foreground/20'
    : 'bg-muted/60 border-border';
  const subText = out ? 'text-primary-foreground/70' : 'text-muted-foreground';

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-2.5 min-w-[260px] max-w-[320px]', surface)}>
      <div className={cn('relative h-12 w-12 rounded-lg flex items-center justify-center text-white shrink-0', color)}>
        <Icon className="h-6 w-6" />
        {ext && (
          <span className="absolute -bottom-1 -right-1 text-[9px] font-bold uppercase bg-background text-foreground px-1 rounded border border-border">
            {ext.slice(0, 4)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={displayName}>{displayName}</div>
        <div className={cn('text-[11px] flex items-center gap-2', subText)}>
          {size != null && <span>{formatBytes(size)}</span>}
          {ext && <span className="uppercase">{ext}</span>}
          {error && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" /> erro
            </span>
          )}
        </div>
        {downloading && progress != null && (
          <div className="mt-1.5 h-1 w-full rounded-full bg-background/40 overflow-hidden">
            <div
              className="h-full bg-current transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        title={error ? 'Tentar novamente' : 'Baixar'}
        className={cn(
          'h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition',
          out ? 'hover:bg-primary-foreground/15' : 'hover:bg-foreground/5',
          downloading && 'opacity-70 cursor-wait'
        )}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : error ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function MessageBubble({ m, senderName }: { m: Message; senderName?: string | null }) {
  const out = m.direction === 'out';
  const url = m.media_url || '';
  const fileName = m.media_name || '';

  // System messages get a centered, subtle treatment
  if (m.type === 'system') {
    return (
      <div className="flex justify-center my-1">
        <div className="text-[11px] px-3 py-1 rounded-full bg-muted text-muted-foreground border border-border">
          {m.body}
        </div>
      </div>
    );
  }

  const renderMedia = () => {
    if (!url) return null;
    if (m.type === 'image') {
      return (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={fileName || 'imagem'} className="rounded-lg max-h-64 max-w-full object-cover" />
        </a>
      );
    }
    if (m.type === 'audio') {
      return <audio controls src={url} className="max-w-full" />;
    }
    if (m.type === 'video') {
      return <video controls src={url} className="rounded-lg max-h-64 max-w-full" />;
    }
    if (m.type === 'document') {
      return (
        <DocumentAttachment
          url={url}
          fileName={fileName}
          mime={m.media_mime}
          out={out}
        />
      );
    }
    return null;
  };

  const isMediaOnly = (m.type === 'image' || m.type === 'audio' || m.type === 'video' || m.type === 'document') && url;

  // Remove prefixo "*Nome:* " do body para exibição (nome já aparece acima do balão)
  const displayBody = stripSenderPrefix(m.body);

  return (
    <div className={cn('flex flex-col', out ? 'items-end' : 'items-start')}>
      {senderName && (
        <span className="text-[11px] text-muted-foreground mb-0.5 px-2 font-medium">
          {senderName}
        </span>
      )}
      <div className={cn(
        'max-w-[78%] md:max-w-[72%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm space-y-2',
        out ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-card border border-border rounded-bl-sm'
      )}>
        {isMediaOnly && renderMedia()}
        {displayBody && !(isMediaOnly && (m.type === 'image' || m.type === 'audio' || m.type === 'video') && (displayBody.startsWith('🎤') || displayBody.startsWith('🖼️') || displayBody.startsWith('🎬'))) && (
          <div className="whitespace-pre-wrap break-words">{displayBody}</div>
        )}
        <div className={cn('flex items-center gap-1 text-[10px]', out ? 'text-primary-foreground/70 justify-end' : 'text-muted-foreground')}>
          <span title={formatFullDateTime(m.created_at)} className="cursor-help">{formatMessageTime(m.created_at)}</span>
          {out && (
            m.status === 'read' ? (
              <span title="Lido" className="inline-flex items-center gap-0.5 cursor-help"><CheckCheck className="h-3.5 w-3.5 text-sky-300" /></span>
            ) : m.status === 'delivered' ? (
              <span title="Entregue" className="inline-flex items-center gap-0.5 cursor-help opacity-90"><CheckCheck className="h-3.5 w-3.5" /></span>
            ) : m.status === 'failed' ? (
              <span title="Falha no envio" className="inline-flex items-center gap-0.5 cursor-help text-destructive font-bold">!</span>
            ) : m.status === 'pending' ? (
              <span title="Enviando…" className="inline-flex items-center gap-0.5 cursor-help opacity-60"><Clock className="h-3 w-3" /></span>
            ) : (
              <span title="Enviado" className="inline-flex items-center gap-0.5 cursor-help opacity-70"><Check className="h-3.5 w-3.5" /></span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: ProviderConfig | null }) {
  if (!provider) return null;
  const connected = provider.status === 'connected';
  return (
    <Badge variant="outline" className={cn(
      'gap-1.5 border',
      connected ? 'bg-success/10 text-success border-success/30' : 'bg-warning/10 text-warning border-warning/30'
    )}>
      {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {provider.provider === 'mock' ? 'Mock' : provider.provider === 'baileys' ? 'Baileys' : provider.provider === 'evolution' ? 'Evolution' : provider.provider === 'meta_cloud' ? 'Meta API' : 'Desconhecido'}
      {' · '}{connected ? 'conectado' : provider.status}
    </Badge>
  );
}

function ContactPanel({ conversation, onAssignMe, onRefresh }: {
  conversation: Conversation; onAssignMe: () => void; onRefresh: () => void;
}) {
  const [notes, setNotes] = useState(conversation.internal_notes || '');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNotes(conversation.internal_notes || ''); }, [conversation.id]);

  const saveNotes = async () => {
    setSaving(true);
    await supabase.from('wa_conversations').update({ internal_notes: notes }).eq('id', conversation.id);
    setSaving(false);
    toast.success('Notas salvas');
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t) return;
    const next = Array.from(new Set([...(conversation.tags || []), t]));
    await supabase.from('wa_conversations').update({ tags: next }).eq('id', conversation.id);
    setTagInput('');
    onRefresh();
  };

  const removeTag = async (t: string) => {
    const next = (conversation.tags || []).filter(x => x !== t);
    await supabase.from('wa_conversations').update({ tags: next }).eq('id', conversation.id);
    onRefresh();
  };

  const toggleBot = async () => {
    await supabase.from('wa_conversations').update({ bot_paused: !conversation.bot_paused }).eq('id', conversation.id);
    onRefresh();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="text-center">
        <Avatar className="h-16 w-16 mx-auto">
          <AvatarFallback className="bg-primary/10 text-primary">
            {initials(conversation.contact?.name || '?')}
          </AvatarFallback>
        </Avatar>
        <p className="mt-2 font-semibold">{conversation.contact?.name || 'Sem nome'}</p>
        <p className="text-xs text-muted-foreground">{conversation.contact?.phone}</p>
      </div>
      <Separator />
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onAssignMe}>
          <UserIcon className="h-4 w-4 mr-2" /> Atribuir a mim
        </Button>
        <Button variant="outline" size="sm" className="w-full" onClick={toggleBot}>
          <Bot className="h-4 w-4 mr-2" /> {conversation.bot_paused ? 'Reativar bot' : 'Pausar bot'}
        </Button>
      </div>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Tag className="h-3 w-3" /> Tags
        </p>
        <div className="flex flex-wrap gap-1">
          {(conversation.tags || []).map(t => (
            <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => removeTag(t)}>
              {t} ×
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="Nova tag" className="h-8 text-xs"
                 onKeyDown={e => { if (e.key === 'Enter') addTag(); }} />
          <Button size="sm" variant="outline" onClick={addTag}>+</Button>
        </div>
      </div>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notas internas</p>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} placeholder="Apenas a equipe vê estas notas..." />
        <Button size="sm" onClick={saveNotes} disabled={saving} className="w-full">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar notas'}
        </Button>
      </div>
    </div>
  );
}

function NewConversationDialog({ open, onOpenChange, tenantId, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; tenantId: string | null;
  onCreated: (id: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!tenantId || !phone.trim()) return;
    setCreating(true);
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      // Find or create contact
      const { data: existing } = await supabase
        .from('wa_contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', cleanPhone)
        .maybeSingle();

      let contactId = existing?.id;
      if (!contactId) {
        const { data: created, error } = await supabase
          .from('wa_contacts')
          .insert({ tenant_id: tenantId, phone: cleanPhone, name: name.trim() })
          .select('id').maybeSingle();
        if (error) throw error;
        contactId = created!.id;
      }

      const { data: conv, error: convErr } = await supabase
        .from('wa_conversations')
        .insert({ tenant_id: tenantId, contact_id: contactId, status: 'novo' })
        .select('id').maybeSingle();
      if (convErr) throw convErr;

      onCreated(conv!.id);
      onOpenChange(false);
      setPhone(''); setName('');
      toast.success('Conversa criada');
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova conversa</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Telefone (com DDD)</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+55 11 99999-9999" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nome (opcional)</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="João Silva" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={create} disabled={creating || !phone.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

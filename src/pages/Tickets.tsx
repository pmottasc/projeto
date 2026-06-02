import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Search, MessageSquare, History, Paperclip, X, FileImage, FileVideo, File, UserPlus, Send, Trash2, Pencil, Check, Tag, UserCheck, Download, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const sanitizeFileName = (name: string) => {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'arquivo';
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : '';
  return ext ? `${base}.${ext}` : base;
};

type UrgencyLevel = 'baixa' | 'media' | 'alta' | 'critica';
type TicketStatus = 'aberto' | 'em_atendimento' | 'aguardando' | 'resolvido' | 'fechado' | 'em_andamento' | 'finalizado';

const urgencyLabels: Record<string, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica',
};
const statusLabels: Record<string, string> = {
  aberto: 'Aberto',
  em_atendimento: 'Em Atendimento',
  aguardando: 'Aguardando',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
  em_andamento: 'Em Atendimento', // legado
  finalizado: 'Fechado',           // legado
};

const urgencyBadgeClass = (u: string) => ({
  baixa: 'badge-low', media: 'badge-medium', alta: 'badge-high', critica: 'badge-critical',
}[u] || 'badge-low');

const statusBadgeClass = (s: string) => ({
  aberto: 'badge-open',
  em_atendimento: 'badge-progress',
  em_andamento: 'badge-progress',
  aguardando: 'badge-waiting',
  resolvido: 'badge-resolved',
  fechado: 'badge-done',
  finalizado: 'badge-done',
}[s] || 'badge-open');

interface TicketRow {
  id: string; number: number; title: string; description: string;
  urgency: UrgencyLevel; status: TicketStatus; created_by: string;
  created_at: string; updated_at: string; closed_at: string | null;
  requested_for: string | null;
  assignee_id?: string | null;
  resolved_at?: string | null;
}

interface CommentRow { id: string; ticket_id: string; user_id: string; content: string; created_at: string; }
interface HistoryRow { id: string; ticket_id: string; user_id: string; field: string; old_value: string; new_value: string; created_at: string; }
interface AttachmentRow { id: string; ticket_id: string; user_id: string; file_name: string; file_path: string; file_type: string; file_size: number; created_at: string; }

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <FileImage className="h-4 w-4 text-primary" />;
  if (type.startsWith('video/')) return <FileVideo className="h-4 w-4 text-primary" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TicketsProps {
  ticketToOpenId?: string | null;
  onTicketOpened?: () => void;
}

export default function Tickets({ ticketToOpenId, onTicketOpened }: TicketsProps) {
  const { user, isAdmin } = useAuth();
  const { tenantId, isTenantAdmin } = useTenant();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [showNew, setShowNew] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterUrgency, setFilterUrgency] = useState<string>('all');
  const [filterUser, setFilterUser] = useState<string>('all');
  const [newComment, setNewComment] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newUrgency, setNewUrgency] = useState<UrgencyLevel>('media');
  const [newRequestedBy, setNewRequestedBy] = useState<string>('');
  const [newRequestedFor, setNewRequestedFor] = useState<string>('');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const canViewAllTickets = isAdmin || isTenantAdmin;

  const canEditTicket = (t: TicketRow | null) => !!t && !!user && (isAdmin || t.created_by === user.id);

  const startEditing = () => {
    if (!selectedTicket) return;
    setEditTitle(selectedTicket.title);
    setEditDesc(selectedTicket.description);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditTitle('');
    setEditDesc('');
  };

  const saveEdit = async () => {
    if (!user || !selectedTicket || !editTitle.trim()) return;
    setSavingEdit(true);
    const updates: Partial<TicketRow> = {};
    const historyEntries: any[] = [];
    const tid = requireTenantId(tenantId);
    if (editTitle.trim() !== selectedTicket.title) {
      updates.title = editTitle.trim();
      historyEntries.push({ ticket_id: selectedTicket.id, user_id: user.id, field: 'título', old_value: selectedTicket.title, new_value: editTitle.trim(), tenant_id: tid });
    }
    if (editDesc !== selectedTicket.description) {
      updates.description = editDesc;
      historyEntries.push({ ticket_id: selectedTicket.id, user_id: user.id, field: 'descrição', old_value: selectedTicket.description || '(vazio)', new_value: editDesc || '(vazio)', tenant_id: tid });
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      setSavingEdit(false);
      return;
    }
    await supabase.from('tickets').update(updates as any).eq('id', selectedTicket.id);
    if (historyEntries.length > 0) await supabase.from('ticket_history').insert(historyEntries as any);
    setIsEditing(false);
    setSavingEdit(false);
    fetchTickets();
    const { data } = await supabase.from('tickets').select('*').eq('id', selectedTicket.id).single();
    if (data) {
      setSelectedTicket(data as TicketRow);
      const { data: h } = await supabase.from('ticket_history').select('*').eq('ticket_id', selectedTicket.id).order('created_at');
      setHistory((h as HistoryRow[]) || []);
    }
  };

  const emitNotificationsChanged = () => { window.dispatchEvent(new CustomEvent('notifications-changed')); };

  const fetchTickets = useCallback(async () => {
    const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false });
    setTickets((data as TicketRow[]) || []);
  }, []);

  const fetchProfiles = useCallback(async () => {
    if (!tenantId) { setProfiles({}); setAllUsers([]); return; }
    const { data: members } = await supabase
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', tenantId);
    const memberIds = (members || []).map((m: any) => m.user_id);
    if (memberIds.length === 0) { setProfiles({}); setAllUsers([]); return; }
    const { data } = await supabase.from('profiles').select('user_id, name').in('user_id', memberIds);
    const map: Record<string, string> = {};
    const users: { id: string; name: string }[] = [];
    data?.forEach((p: any) => { map[p.user_id] = p.name; users.push({ id: p.user_id, name: p.name }); });
    setProfiles(map);
    setAllUsers(users);
  }, [tenantId]);

  useEffect(() => { if (user) { fetchTickets(); fetchProfiles(); } }, [user, fetchTickets, fetchProfiles]);

  const handleAssigneeChange = async (ticketId: string, assigneeId: string) => {
    if (!user || !selectedTicket) return;
    const tid = requireTenantId(tenantId);
    const newVal = assigneeId === 'none' ? null : assigneeId;
    await supabase.from('tickets').update({ assignee_id: newVal } as any).eq('id', ticketId);
    const oldName = selectedTicket.assignee_id ? (profiles[selectedTicket.assignee_id] || 'Usuário') : '(ninguém)';
    const newName = newVal ? (profiles[newVal] || 'Usuário') : '(ninguém)';
    await supabase.from('ticket_history').insert({ ticket_id: ticketId, user_id: user.id, field: 'atendente', old_value: oldName, new_value: newName, tenant_id: tid } as any);
    if (newVal && newVal !== user.id) {
      await supabase.from('notifications').insert({ user_id: newVal, ticket_id: ticketId, message: `Você foi atribuído ao chamado #${selectedTicket.number}`, tenant_id: tid } as any);
    }
    fetchTickets();
    const { data } = await supabase.from('tickets').select('*').eq('id', ticketId).single();
    if (data) setSelectedTicket(data as TicketRow);
  };

  const loadTicketDetails = async (ticket: TicketRow) => {
    setSelectedTicket(ticket);
    const [{ data: c }, { data: h }, { data: a }] = await Promise.all([
      supabase.from('ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at'),
      supabase.from('ticket_history').select('*').eq('ticket_id', ticket.id).order('created_at'),
      supabase.from('ticket_attachments').select('*').eq('ticket_id', ticket.id).order('created_at'),
    ]);
    setComments((c as CommentRow[]) || []);
    setHistory((h as HistoryRow[]) || []);
    setAttachments((a as AttachmentRow[]) || []);
    if (user) {
      await supabase.from('notifications').delete().eq('user_id', user.id).eq('ticket_id', ticket.id).eq('read', false);
      emitNotificationsChanged();
    }
  };

  const handleDeleteTicket = async () => {
    if (!selectedTicket || !isAdmin || !window.confirm(`Deseja excluir o chamado #${selectedTicket.number}?`)) return;
    const attachmentPaths = attachments.map(a => a.file_path);
    if (attachmentPaths.length > 0) await supabase.storage.from('ticket-attachments').remove(attachmentPaths).catch(() => undefined);
    await Promise.all([
      supabase.from('ticket_comments').delete().eq('ticket_id', selectedTicket.id),
      supabase.from('ticket_history').delete().eq('ticket_id', selectedTicket.id),
      supabase.from('ticket_attachments').delete().eq('ticket_id', selectedTicket.id),
      supabase.from('notifications').delete().eq('ticket_id', selectedTicket.id),
    ]);
    await supabase.from('tickets').delete().eq('id', selectedTicket.id);
    setSelectedTicket(null);
    emitNotificationsChanged();
    fetchTickets();
  };

  const uploadFiles = async (ticketId: string, files: File[]) => {
    if (!user) { toast.error('Você precisa estar logado'); return 0; }
    let tid: string;
    try { tid = requireTenantId(tenantId); } catch { toast.error('Tenant não definido'); return 0; }
    let okCount = 0;
    for (const file of files) {
      const safeName = sanitizeFileName(file.name);
      const filePath = `${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const { error: upErr } = await supabase.storage.from('ticket-attachments').upload(filePath, file, {
        contentType: file.type || 'application/octet-stream', upsert: false,
      });
      if (upErr) { toast.error(`Falha no upload de ${file.name}: ${upErr.message}`); continue; }
      const { error: insErr } = await supabase.from('ticket_attachments').insert({
        ticket_id: ticketId, user_id: user.id, file_name: file.name, file_path: filePath,
        file_type: file.type, file_size: file.size, tenant_id: tid,
      } as any);
      if (insErr) {
        toast.error(`Erro ao salvar registro do anexo: ${insErr.message}`);
        await supabase.storage.from('ticket-attachments').remove([filePath]).catch(() => undefined);
        continue;
      }
      okCount++;
    }
    if (okCount > 0) toast.success(`${okCount} anexo(s) enviado(s)`);
    return okCount;
  };

  const handleCreate = async () => {
    if (!user || !newTitle.trim()) return;
    const tid = requireTenantId(tenantId);
    setUploading(true);
    // RLS exige created_by = auth.uid(). Se admin abrir em nome de outro, usamos requested_for.
    const onBehalfOf = (isAdmin && newRequestedBy && newRequestedBy !== user.id) ? newRequestedBy : null;
    const requestedForFinal = onBehalfOf
      || (isAdmin && newRequestedFor && newRequestedFor !== 'none' && newRequestedFor !== user.id ? newRequestedFor : null);
    const insertData: any = { title: newTitle.trim(), description: newDesc.trim(), urgency: newUrgency as any, created_by: user.id, tenant_id: tid };
    if (requestedForFinal) insertData.requested_for = requestedForFinal;
    const { data: ticket, error: ticketErr } = await supabase.from('tickets').insert(insertData).select().single();
    if (ticketErr) { toast.error(`Erro ao criar chamado: ${ticketErr.message}`); setUploading(false); return; }
    if (ticket) {
      await supabase.from('ticket_history').insert({ ticket_id: ticket.id, user_id: user.id, field: 'status', old_value: '', new_value: 'aberto', tenant_id: tid } as any);
      if (newFiles.length > 0) await uploadFiles(ticket.id, newFiles);
      const { data: adminRoles } = await supabase.from('user_roles').select('user_id').in('role', ['admin', 'supervisor'] as any);
      if (adminRoles) {
        const notifications = adminRoles.filter(r => r.user_id !== user.id).map(r => ({ user_id: r.user_id, ticket_id: ticket.id, message: `Novo chamado #${(ticket as any).number}: ${newTitle.trim()}`, tenant_id: tid }));
        if (notifications.length > 0) await supabase.from('notifications').insert(notifications as any);
      }
      if (insertData.requested_for) {
        await supabase.from('notifications').insert({ user_id: insertData.requested_for, ticket_id: ticket.id, message: `Você foi adicionado como solicitante no chamado #${(ticket as any).number}: ${newTitle.trim()}`, tenant_id: tid } as any);
      }
    }
    setShowNew(false); setNewTitle(''); setNewDesc(''); setNewUrgency('media'); setNewRequestedBy(''); setNewRequestedFor(''); setNewFiles([]);
    setUploading(false);
    fetchTickets();
  };

  const handleStatusChange = async (ticketId: string, status: TicketStatus) => {
    if (!user || !selectedTicket) return;
    const tid = requireTenantId(tenantId);
    const isClosing = status === 'fechado' || status === 'finalizado' || status === 'resolvido';
    await supabase.from('tickets').update({ status: status as any, ...(isClosing ? { closed_at: new Date().toISOString() } : {}) }).eq('id', ticketId);
    await supabase.from('ticket_history').insert({ ticket_id: ticketId, user_id: user.id, field: 'status', old_value: selectedTicket.status, new_value: status, tenant_id: tid } as any);
    const notifyUsers = new Set<string>();
    if (selectedTicket.created_by !== user.id) notifyUsers.add(selectedTicket.created_by);
    if (selectedTicket.requested_for && selectedTicket.requested_for !== user.id) notifyUsers.add(selectedTicket.requested_for);
    const notifications = Array.from(notifyUsers).map(uid => ({ user_id: uid, ticket_id: ticketId, message: `Chamado #${selectedTicket.number} alterado para ${statusLabels[status]}`, tenant_id: tid }));
    if (notifications.length > 0) await supabase.from('notifications').insert(notifications as any);
    fetchTickets();
    const { data } = await supabase.from('tickets').select('*').eq('id', ticketId).single();
    if (data) loadTicketDetails(data as TicketRow);
  };

  const handleUrgencyChange = async (ticketId: string, urgency: UrgencyLevel) => {
    if (!user || !selectedTicket) return;
    await supabase.from('tickets').update({ urgency: urgency as any }).eq('id', ticketId);
    await supabase.from('ticket_history').insert({ ticket_id: ticketId, user_id: user.id, field: 'urgência', old_value: selectedTicket.urgency, new_value: urgency, tenant_id: requireTenantId(tenantId) } as any);
    fetchTickets();
    const { data } = await supabase.from('tickets').select('*').eq('id', ticketId).single();
    if (data) loadTicketDetails(data as TicketRow);
  };

  const handleComment = async () => {
    if (!user || !selectedTicket || !newComment.trim()) return;
    const tid = requireTenantId(tenantId);
    await supabase.from('ticket_comments').insert({ ticket_id: selectedTicket.id, user_id: user.id, content: newComment.trim(), tenant_id: tid } as any);
    const notifyUsers = new Set<string>();
    if (selectedTicket.created_by !== user.id) notifyUsers.add(selectedTicket.created_by);
    if (selectedTicket.requested_for && selectedTicket.requested_for !== user.id) notifyUsers.add(selectedTicket.requested_for);
    const notifications = Array.from(notifyUsers).map(uid => ({ user_id: uid, ticket_id: selectedTicket.id, message: `Novo comentário no chamado #${selectedTicket.number}`, tenant_id: tid }));
    if (notifications.length > 0) await supabase.from('notifications').insert(notifications as any);
    setNewComment('');
    const { data } = await supabase.from('ticket_comments').select('*').eq('ticket_id', selectedTicket.id).order('created_at');
    setComments((data as CommentRow[]) || []);
  };

  const handleDetailFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !selectedTicket || !user) return;
    setUploading(true);
    await uploadFiles(selectedTicket.id, Array.from(e.target.files));
    const { data } = await supabase.from('ticket_attachments').select('*').eq('ticket_id', selectedTicket.id).order('created_at');
    setAttachments((data as AttachmentRow[]) || []);
    setUploading(false);
    e.target.value = '';
  };

  const handleDeleteAttachment = async (att: AttachmentRow) => {
    if (!selectedTicket) return;
    if (!window.confirm(`Remover o anexo "${att.file_name}"?`)) return;
    const { error: dbErr } = await supabase.from('ticket_attachments').delete().eq('id', att.id);
    if (dbErr) { toast.error('Erro ao remover anexo: ' + dbErr.message); return; }
    await supabase.storage.from('ticket-attachments').remove([att.file_path]).catch(() => undefined);
    setAttachments(curr => curr.filter(a => a.id !== att.id));
    toast.success('Anexo removido');
  };

  const getAttachmentUrl = (filePath: string) => {
    const { data } = supabase.storage.from('ticket-attachments').getPublicUrl(filePath);
    return data.publicUrl;
  };

  // Baixa via SDK (evita filtros de URL como ERR_BLOCKED_BY_CLIENT) e abre/salva via blob.
  const downloadAttachment = async (att: AttachmentRow, mode: 'open' | 'save' = 'open') => {
    try {
      const { data, error } = await supabase.storage.from('ticket-attachments').download(att.file_path);
      if (error || !data) throw error || new Error('Falha ao baixar');
      const blob = new Blob([data], { type: att.file_type || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      if (mode === 'save') {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = att.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
        if (!w) {
          // fallback: força download se popup foi bloqueado
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = att.file_name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e: any) {
      toast.error('Erro ao abrir anexo: ' + (e?.message || 'desconhecido'));
    }
  };

  const filtered = useMemo(() => tickets.filter(t => {
    if (!canViewAllTickets && t.created_by !== user?.id && t.requested_for !== user?.id) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterUrgency !== 'all' && t.urgency !== filterUrgency) return false;
    if (filterUser !== 'all' && t.created_by !== filterUser) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !t.number.toString().includes(q)) return false;
    }
    return true;
  }), [tickets, canViewAllTickets, user?.id, filterStatus, filterUrgency, filterUser, searchQuery]);

  const ticketUsers = canViewAllTickets
    ? [...new Set(tickets.map(t => t.created_by))].map(uid => ({ id: uid, name: profiles[uid] || 'Usuário' }))
    : [];

  useEffect(() => {
    if (!ticketToOpenId || tickets.length === 0) return;
    const targetTicket = tickets.find(t => t.id === ticketToOpenId);
    if (targetTicket) void loadTicketDetails(targetTicket);
    onTicketOpened?.();
  }, [ticketToOpenId, tickets, onTicketOpened]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">Chamados</h1>
          <p className="text-[13px] text-muted-foreground mt-1">{filtered.length} chamado(s) encontrado(s)</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="h-10 text-[13px] font-semibold px-5">
          <Plus className="h-4 w-4 mr-2" /> Novo Chamado
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por título ou número..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10 h-10 text-[13px]" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px] h-10 text-[13px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Status</SelectItem>
            <SelectItem value="aberto">Aberto</SelectItem>
            <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
            <SelectItem value="aguardando">Aguardando</SelectItem>
            <SelectItem value="resolvido">Resolvido</SelectItem>
            <SelectItem value="fechado">Fechado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterUrgency} onValueChange={setFilterUrgency}>
          <SelectTrigger className="w-[140px] h-10 text-[13px]"><SelectValue placeholder="Urgência" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="critica">Crítica</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={filterUser} onValueChange={setFilterUser}>
            <SelectTrigger className="w-[180px] h-10 text-[13px]"><SelectValue placeholder="Usuário" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Usuários</SelectItem>
              {ticketUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Ticket List */}
      <div className="bg-card rounded-xl border overflow-hidden" style={{ borderColor: 'hsl(var(--border) / 0.7)' }}>
        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-4">
              <Search className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-[14px] text-muted-foreground font-medium">Nenhum chamado encontrado</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">Tente ajustar os filtros</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'hsl(var(--border) / 0.5)' }}>
            {filtered.map(ticket => (
              <div
                key={ticket.id}
                className="flex items-center justify-between px-6 py-4 hover:bg-accent/40 transition-colors duration-200 cursor-pointer group"
                onClick={() => loadTicketDetails(ticket)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    <span className="text-muted-foreground font-mono text-[12px]">#{ticket.number}</span>
                    <span className="mx-2.5 text-border">·</span>
                    {ticket.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {profiles[ticket.created_by] || 'Usuário'}
                    {ticket.requested_for && ` · Solicitante: ${profiles[ticket.requested_for] || 'Usuário'}`}
                    {' · '}{new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 ml-4">
                  <span className={`badge-status ${urgencyBadgeClass(ticket.urgency)}`}>
                    {urgencyLabels[ticket.urgency] || ticket.urgency}
                  </span>
                  <span className={`badge-status ${statusBadgeClass(ticket.status)}`}>
                    {statusLabels[ticket.status] || ticket.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Ticket Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Novo Chamado</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Título</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Resumo do problema" className="h-10 text-[13px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Descrição</Label>
              <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descreva o problema em detalhes..." rows={4} className="text-[13px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Urgência</Label>
              <Select value={newUrgency} onValueChange={v => setNewUrgency(v as UrgencyLevel)}>
                <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <>
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium">Solicitante principal</Label>
                  <Select value={newRequestedBy} onValueChange={setNewRequestedBy}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Solicitante adicional</Label>
                  <Select value={newRequestedFor} onValueChange={setNewRequestedFor}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {allUsers.filter(u => u.id !== newRequestedBy).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Anexos</Label>
              <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={e => { if (e.target.files) setNewFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
              <Button type="button" variant="outline" size="sm" className="h-9 text-[12px]" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Adicionar Arquivo
              </Button>
              {newFiles.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {newFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-[12px] bg-accent/60 rounded-lg px-3 py-2">
                      {getFileIcon(file.type)}
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
                      <button onClick={() => setNewFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => { setShowNew(false); setNewFiles([]); }}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newTitle.trim() || uploading}>
              {uploading ? 'Enviando...' : 'Criar Chamado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => { setSelectedTicket(null); cancelEditing(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0">
          {selectedTicket && (
            <div>
              {/* Detail Header */}
              <div className="px-7 py-6 border-b" style={{ borderColor: 'hsl(var(--border) / 0.6)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground font-mono mb-1.5">Chamado #{selectedTicket.number}</p>
                    {isEditing ? (
                      <Input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="h-10 text-[15px] font-bold"
                        placeholder="Título do chamado"
                      />
                    ) : (
                      <h2 className="text-[17px] font-bold text-foreground leading-snug">{selectedTicket.title}</h2>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`badge-status ${urgencyBadgeClass(selectedTicket.urgency)}`}>
                      {urgencyLabels[selectedTicket.urgency] || selectedTicket.urgency}
                    </span>
                    <span className={`badge-status ${statusBadgeClass(selectedTicket.status)}`}>
                      {statusLabels[selectedTicket.status] || selectedTicket.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-7 py-6 space-y-8">
                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="section-heading">Descrição</p>
                    {canEditTicket(selectedTicket) && (
                      isEditing ? (
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={cancelEditing} disabled={savingEdit}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                          </Button>
                          <Button size="sm" className="h-8 text-[12px]" onClick={saveEdit} disabled={savingEdit || !editTitle.trim()}>
                            <Check className="h-3.5 w-3.5 mr-1" /> {savingEdit ? 'Salvando...' : 'Salvar'}
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={startEditing}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                        </Button>
                      )
                    )}
                  </div>
                  <div className="rounded-xl bg-accent/50 p-5">
                    {isEditing ? (
                      <Textarea
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        rows={5}
                        placeholder="Descreva o problema em detalhes..."
                        className="text-[13px] bg-background"
                      />
                    ) : (
                      <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{selectedTicket.description || 'Sem descrição'}</p>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-4 pt-3 space-y-1" style={{ borderTop: '1px solid hsl(var(--border) / 0.5)' }}>
                      <p>Criado em {new Date(selectedTicket.created_at).toLocaleString('pt-BR')} por <span className="font-medium text-foreground">{profiles[selectedTicket.created_by] || 'Usuário'}</span></p>
                      {selectedTicket.requested_for && (
                        <p className="flex items-center gap-1"><UserPlus className="h-3 w-3" /> Solicitante adicional: <span className="font-medium text-foreground">{profiles[selectedTicket.requested_for] || 'Usuário'}</span></p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Admin Controls */}
                {isAdmin && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="flex-1 space-y-2">
                        <Label className="section-heading">Status</Label>
                        <Select value={selectedTicket.status} onValueChange={v => handleStatusChange(selectedTicket.id, v as TicketStatus)}>
                          <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="aberto">Aberto</SelectItem>
                            <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                            <SelectItem value="aguardando">Aguardando</SelectItem>
                            <SelectItem value="resolvido">Resolvido</SelectItem>
                            <SelectItem value="fechado">Fechado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-2">
                        <Label className="section-heading">Urgência</Label>
                        <Select value={selectedTicket.urgency} onValueChange={v => handleUrgencyChange(selectedTicket.id, v as UrgencyLevel)}>
                          <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="baixa">Baixa</SelectItem>
                            <SelectItem value="media">Média</SelectItem>
                            <SelectItem value="alta">Alta</SelectItem>
                            <SelectItem value="critica">Crítica</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="outline" className="text-destructive hover:text-destructive border-destructive/20 hover:bg-destructive/5 h-10 text-[12px] font-medium" onClick={handleDeleteTicket}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label className="section-heading flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" /> Atendente</Label>
                      <Select value={selectedTicket.assignee_id || 'none'} onValueChange={v => handleAssigneeChange(selectedTicket.id, v)}>
                        <SelectTrigger className="h-10 text-[13px]"><SelectValue placeholder="Selecione um atendente..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ninguém atribuído</SelectItem>
                          {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Attachments */}
                <div>
                  <p className="section-heading mb-3 flex items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5" /> Anexos ({attachments.length})
                  </p>
                  {attachments.length > 0 && (
                    <div className="space-y-2.5 mb-4">
                       {attachments.map(att => {
                        const url = getAttachmentUrl(att.file_path);
                        const isImage = att.file_type.startsWith('image/');
                        const isVideo = att.file_type.startsWith('video/');
                        return (
                          <div key={att.id} className="rounded-xl bg-accent/50 p-4">
                            {isImage && (
                              <button type="button" onClick={() => downloadAttachment(att, 'open')} className="block w-full">
                                <img src={url} alt={att.file_name} className="max-h-52 rounded-lg mb-2.5 object-contain" />
                              </button>
                            )}
                            {isVideo && <video src={url} controls className="max-h-52 rounded-lg mb-2.5 w-full" />}
                            <div className="flex items-center gap-2.5 text-[12px]">
                              {getFileIcon(att.file_type)}
                              <button
                                type="button"
                                onClick={() => downloadAttachment(att, 'open')}
                                className="text-primary hover:underline truncate font-medium text-left flex-1 min-w-0"
                                title="Abrir"
                              >
                                {att.file_name}
                              </button>
                              <span className="text-muted-foreground tabular-nums">{formatFileSize(att.file_size)}</span>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadAttachment(att, 'open')} title="Abrir em nova aba">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadAttachment(att, 'save')} title="Baixar">
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              {(isAdmin || att.user_id === user?.id) && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteAttachment(att)} title="Remover anexo">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <input ref={detailFileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={handleDetailFileUpload} />
                  <Button variant="outline" size="sm" className="h-9 text-[12px]" onClick={() => detailFileInputRef.current?.click()} disabled={uploading}>
                    <Paperclip className="h-3.5 w-3.5 mr-1.5" /> {uploading ? 'Enviando...' : 'Adicionar Anexo'}
                  </Button>
                </div>

                {/* Comments */}
                <div>
                  <p className="section-heading mb-3 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" /> Comentários ({comments.length})
                  </p>
                  {comments.length > 0 && (
                    <div className="space-y-2.5 mb-4">
                      {comments.map(c => (
                        <div key={c.id} className="rounded-xl bg-accent/50 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                              {(profiles[c.user_id] || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span className="text-[12px] font-medium text-foreground">{profiles[c.user_id] || 'Usuário'}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{new Date(c.created_at).toLocaleString('pt-BR')}</span>
                          </div>
                          <p className="text-[13px] text-foreground leading-relaxed pl-8">{c.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2.5">
                    <Input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Escreva um comentário..." className="h-10 text-[13px]" onKeyDown={e => e.key === 'Enter' && handleComment()} />
                    <Button onClick={handleComment} disabled={!newComment.trim()} className="h-10 px-4">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* History */}
                <div>
                  <p className="section-heading mb-3 flex items-center gap-2">
                    <History className="h-3.5 w-3.5" /> Histórico
                  </p>
                  <div className="space-y-0">
                    {history.map(h => (
                      <div key={h.id} className="flex items-center gap-3 text-[11px] text-muted-foreground py-2 border-l-2 border-border pl-4 ml-1.5">
                        <span>
                          <span className="font-medium text-foreground">{profiles[h.user_id] || 'Usuário'}</span> alterou {h.field}
                          {h.old_value && <> de <em>{h.old_value}</em></>} para <em className="font-medium text-foreground">{h.new_value}</em>
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] tabular-nums">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

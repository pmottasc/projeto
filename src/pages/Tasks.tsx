import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Search, MoreVertical, Trash2, Calendar, Loader2, AlertCircle, Ticket as TicketIcon, X, Building2, Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractTextFromPDF } from '@/lib/pdf-parser';

type Status = 'a_fazer' | 'em_andamento' | 'em_revisao' | 'concluido';
type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

interface Task {
  id: string;
  tenant_id: string;
  titulo: string;
  descricao: string;
  status: Status;
  prioridade: Prioridade;
  responsavel_id: string | null;
  criado_por: string;
  data_prevista: string | null;
  comentarios: Array<{ user_id: string; text: string; at: string }>;
  position: number;
  last_status_changed_by: string | null;
  last_status_changed_at: string | null;
  created_at: string;
  updated_at: string;
  ticket_id: string | null;
  company_id: string | null;
  tipo_servico: string | null;
}

interface TicketLite {
  id: string;
  number: number;
  title: string;
  description: string;
  urgency: string;
  assignee_id: string | null;
  status: string;
}

interface Company {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  municipio: string;
  uf: string;
}

function formatCnpj(s: string) {
  const d = (s || '').replace(/\D/g, '').padStart(14, '0').slice(-14);
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}

const COLUMNS: Array<{ id: Status; label: string; dot: string; ring: string; headerBg: string }> = [
  { id: 'a_fazer', label: 'A Fazer', dot: 'bg-muted-foreground', ring: 'ring-muted-foreground/20', headerBg: 'bg-muted/60' },
  { id: 'em_andamento', label: 'Em Andamento', dot: 'bg-[hsl(var(--brand-blue))]', ring: 'ring-[hsl(var(--brand-blue)/0.3)]', headerBg: 'bg-[hsl(var(--brand-blue)/0.08)]' },
  { id: 'em_revisao', label: 'Em Revisão', dot: 'bg-warning', ring: 'ring-warning/30', headerBg: 'bg-warning/10' },
  { id: 'concluido', label: 'Concluído', dot: 'bg-success', ring: 'ring-success/30', headerBg: 'bg-success/10' },
];

const PRIO_CFG: Record<Prioridade, { label: string; cls: string }> = {
  baixa:   { label: 'Baixa',   cls: 'bg-muted text-muted-foreground border' },
  media:   { label: 'Média',   cls: 'bg-[hsl(var(--brand-blue)/0.15)] text-[hsl(var(--brand-blue))] border-[hsl(var(--brand-blue)/0.3)] border' },
  alta:    { label: 'Alta',    cls: 'bg-warning/15 text-warning border-warning/30 border' },
  urgente: { label: 'Urgente', cls: 'bg-destructive/15 text-destructive border-destructive/30 border' },
};

const TIPO_SERVICO_OPTIONS: Array<{ id: string; label: string; cls: string }> = [
  { id: 'constituicao',     label: 'Constituição de Empresa', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  { id: 'baixa',            label: 'Baixa de Empresa',        cls: 'bg-destructive/15 text-destructive border-destructive/30' },
  { id: 'alteracao',        label: 'Alteração de Empresa',    cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  { id: 'abertura_filial',  label: 'Abertura de Filial',      cls: 'bg-[hsl(var(--brand-blue)/0.15)] text-[hsl(var(--brand-blue))] border-[hsl(var(--brand-blue)/0.3)]' },
];
const tipoServicoLabel = (id: string | null) => TIPO_SERVICO_OPTIONS.find(t => t.id === id)?.label || id || '';
const tipoServicoCls   = (id: string | null) => TIPO_SERVICO_OPTIONS.find(t => t.id === id)?.cls || 'bg-muted text-muted-foreground border';

function initials(s: string) {
  return s.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

export default function Tasks() {
  const { user, isAdmin } = useAuth();
  const { tenantId } = useTenant();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPrio, setFilterPrio] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<'chamados' | 'empresas'>('chamados');
  const [filterTipoServico, setFilterTipoServico] = useState<string>('all');
  const [newTask, setNewTask] = useState({
    titulo: '', descricao: '', status: 'a_fazer' as Status,
    prioridade: 'media' as Prioridade, data_prevista: '', responsavel_id: '',
    ticket_id: '' as string,
    company_id: '' as string,
    tipo_servico: '' as string,
  });
  const [tickets, setTickets] = useState<TicketLite[]>([]);
  const [ticketSearch, setTicketSearch] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [showNewCompany, setShowNewCompany] = useState(false);

  const memberName = (id: string | null) =>
    !id ? '—' : (members.find(m => m.user_id === id)?.name || 'Usuário');

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    setTasks((data || []) as any);
    setLoading(false);
  };

  const loadCompanies = async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from('companies')
      .select('id, cnpj, razao_social, nome_fantasia, municipio, uf')
      .eq('tenant_id', tenantId)
      .order('razao_social', { ascending: true });
    setCompanies((data || []) as any);
  };

  useEffect(() => {
    if (!tenantId) return;
    void load();
    (async () => {
      const { data: tm } = await supabase
        .from('tenant_members').select('user_id').eq('tenant_id', tenantId);
      const ids = (tm || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: profs } = await supabase
        .from('profiles').select('user_id, name, username').in('user_id', ids);
      setMembers((profs || []).map((p: any) => ({
        user_id: p.user_id, name: p.name || p.username || 'Usuário',
      })).sort((a, b) => a.name.localeCompare(b.name)));
    })();

    (async () => {
      const { data: tks } = await supabase
        .from('tickets')
        .select('id, number, title, description, urgency, assignee_id, status')
        .eq('tenant_id', tenantId)
        .in('status', ['aberto', 'em_andamento'])
        .order('created_at', { ascending: false })
        .limit(200);
      setTickets((tks || []) as any);
    })();

    void loadCompanies();
    const ch = supabase
      .channel(`tasks-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `tenant_id=eq.${tenantId}` },
        () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenantId]);

  const periodRange = useMemo<{ from: Date | null; to: Date | null }>(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filterPeriod === 'today') {
      const end = new Date(startToday); end.setDate(end.getDate() + 1);
      return { from: startToday, to: end };
    }
    if (filterPeriod === 'week') {
      const day = startToday.getDay(); // 0=Sun
      const from = new Date(startToday); from.setDate(from.getDate() - day);
      const to = new Date(from); to.setDate(to.getDate() + 7);
      return { from, to };
    }
    if (filterPeriod === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
    if (filterPeriod === 'custom') {
      return {
        from: filterFrom ? new Date(filterFrom + 'T00:00:00') : null,
        to: filterTo ? new Date(filterTo + 'T23:59:59') : null,
      };
    }
    return { from: null, to: null };
  }, [filterPeriod, filterFrom, filterTo]);

  const filtered = useMemo(() => tasks.filter(t => {
    // View tab: chamados (sem empresa) vs empresas (com empresa)
    if (view === 'empresas') {
      if (!t.company_id) return false;
      if (filterTipoServico !== 'all' && t.tipo_servico !== filterTipoServico) return false;
    } else { if (t.company_id) return false; }
    if (search && !t.titulo.toLowerCase().includes(search.toLowerCase())
      && !t.descricao.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterAssignee !== 'all') {
      if (filterAssignee === 'none') { if (t.responsavel_id) return false; }
      else if (t.responsavel_id !== filterAssignee) return false;
    }
    if (filterPrio !== 'all' && t.prioridade !== filterPrio) return false;
    if (periodRange.from || periodRange.to) {
      const ref = t.data_prevista ? new Date(t.data_prevista + 'T12:00:00') : new Date(t.created_at);
      if (periodRange.from && ref < periodRange.from) return false;
      if (periodRange.to && ref >= periodRange.to) return false;
    }
    return true;
  }), [tasks, view, search, filterAssignee, filterPrio, periodRange, filterTipoServico]);

  const canEdit = (t: Task) => isAdmin || t.criado_por === user?.id || t.responsavel_id === user?.id;
  const canDelete = (t: Task) => isAdmin || t.criado_por === user?.id;

  const create = async () => {
    if (!newTask.titulo.trim() || !tenantId || !user) return;
    if (view === 'empresas' && !newTask.company_id) {
      toast.error('Selecione uma empresa'); return;
    }
    if (view === 'empresas' && !newTask.tipo_servico) {
      toast.error('Selecione o tipo de serviço'); return;
    }
    const { error } = await supabase.from('tasks').insert({
      tenant_id: tenantId,
      titulo: newTask.titulo.trim(),
      descricao: newTask.descricao,
      status: newTask.status,
      prioridade: newTask.prioridade,
      data_prevista: newTask.data_prevista || null,
      responsavel_id: newTask.responsavel_id || user.id,
      criado_por: user.id,
      position: tasks.filter(t => t.status === newTask.status).length,
      ticket_id: view === 'empresas' ? null : (newTask.ticket_id || null),
      company_id: view === 'empresas' ? (newTask.company_id || null) : null,
      tipo_servico: view === 'empresas' ? (newTask.tipo_servico || null) : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Tarefa criada');
    setShowNew(false);
    setNewTask({ titulo: '', descricao: '', status: 'a_fazer', prioridade: 'media', data_prevista: '', responsavel_id: '', ticket_id: '', company_id: '', tipo_servico: '' });
    setTicketSearch('');
    setCompanySearch('');
  };

  const URGENCY_TO_PRIO: Record<string, Prioridade> = {
    baixa: 'baixa', media: 'media', alta: 'alta', critica: 'urgente', urgente: 'urgente',
  };

  const applyTicket = (tk: TicketLite | null) => {
    if (!tk) {
      setNewTask(s => ({ ...s, ticket_id: '' }));
      return;
    }
    setNewTask(s => ({
      ...s,
      ticket_id: tk.id,
      titulo: s.titulo.trim() ? s.titulo : `#${tk.number} - ${tk.title}`,
      descricao: s.descricao.trim() ? s.descricao : tk.description,
      prioridade: URGENCY_TO_PRIO[tk.urgency] || s.prioridade,
      responsavel_id: s.responsavel_id || tk.assignee_id || '',
    }));
  };

  const moveTask = async (task: Task, newStatus: Status) => {
    if (task.status === newStatus) return;
    if (!canEdit(task)) { toast.error('Sem permissão para mover esta tarefa'); return; }
    const { error } = await supabase.from('tasks').update({
      status: newStatus,
      last_status_changed_by: user?.id,
      last_status_changed_at: new Date().toISOString(),
      position: tasks.filter(t => t.status === newStatus).length,
    }).eq('id', task.id);
    if (error) toast.error(error.message);
  };

  const updateTask = async (patch: Partial<Task>) => {
    if (!editing) return;
    const { error } = await supabase.from('tasks').update(patch).eq('id', editing.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Atualizado');
    setEditing(null);
  };

  const removeTask = async (t: Task) => {
    if (!confirm(`Excluir a tarefa "${t.titulo}"?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) toast.error(error.message); else toast.success('Excluída');
  };

  const addComment = async (t: Task, text: string) => {
    if (!text.trim() || !user) return;
    const next = [...(t.comentarios || []), {
      user_id: user.id, text: text.trim(), at: new Date().toISOString(),
    }];
    const { error } = await supabase.from('tasks').update({ comentarios: next as any }).eq('id', t.id);
    if (error) toast.error(error.message);
    else setEditing(prev => prev ? { ...prev, comentarios: next } : prev);
  };

  const isOverdue = (t: Task) =>
    t.data_prevista && t.status !== 'concluido' && new Date(t.data_prevista) < new Date(new Date().toDateString());

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {isAdmin && (
        <div className="px-4 pt-3 bg-card border-b border-border">
          <Tabs value={view} onValueChange={v => setView(v as any)}>
            <TabsList>
              <TabsTrigger value="chamados" className="gap-1.5">
                <TicketIcon className="h-3.5 w-3.5" /> Chamados
              </TabsTrigger>
              <TabsTrigger value="empresas" className="gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Empresas
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tarefas..."
            className="h-9 max-w-xs"
          />
        </div>
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos responsáveis</SelectItem>
            <SelectItem value="none">Sem responsável</SelectItem>
            {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPrio} onValueChange={setFilterPrio}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas prioridades</SelectItem>
            {(Object.keys(PRIO_CFG) as Prioridade[]).map(p => (
              <SelectItem key={p} value={p}>{PRIO_CFG[p].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPeriod} onValueChange={v => setFilterPeriod(v as any)}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo período</SelectItem>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        {view === 'empresas' && (
          <Select value={filterTipoServico} onValueChange={setFilterTipoServico}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Tipo de serviço" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {TIPO_SERVICO_OPTIONS.map(o => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterPeriod === 'custom' && (
          <>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 w-[150px]" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9 w-[150px]" />
          </>
        )}
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9"><Plus className="h-4 w-4 mr-1" /> Nova tarefa</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg overflow-hidden">
            <DialogHeader><DialogTitle>Nova tarefa</DialogTitle></DialogHeader>
            <div className="space-y-3 min-w-0">
              {view === 'empresas' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> Empresa <span className="text-destructive">*</span>
                  </label>
                  {newTask.company_id ? (() => {
                    const co = companies.find(x => x.id === newTask.company_id);
                    return (
                      <div className="flex items-center justify-between gap-2 border rounded-md px-2 py-1.5 bg-muted/40 min-w-0">
                        <div className="text-xs truncate min-w-0 flex-1">
                          <span className="font-mono text-primary">{formatCnpj(co?.cnpj || '')}</span>{' '}
                          {co?.razao_social}
                        </div>
                        <button type="button" onClick={() => setNewTask(s => ({ ...s, company_id: '' }))}
                          className="text-muted-foreground hover:text-destructive shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })() : (
                    <>
                      <div className="flex gap-1.5">
                        <Input placeholder="Buscar empresa por CNPJ ou razão social..." value={companySearch}
                          onChange={e => setCompanySearch(e.target.value)} className="h-8" />
                        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0"
                          onClick={() => setShowNewCompany(true)}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Nova
                        </Button>
                      </div>
                      {companySearch.trim() && (
                        <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                          {companies.filter(co => {
                            const q = companySearch.toLowerCase().replace(/\D/g, '');
                            const txt = companySearch.toLowerCase();
                            return (q && co.cnpj.includes(q))
                              || co.razao_social.toLowerCase().includes(txt)
                              || co.nome_fantasia.toLowerCase().includes(txt);
                          }).slice(0, 10).map(co => (
                            <button key={co.id} type="button"
                              onClick={() => {
                                setNewTask(s => ({
                                  ...s,
                                  company_id: co.id,
                                  titulo: s.titulo.trim() ? s.titulo : (co.nome_fantasia || co.razao_social),
                                }));
                                setCompanySearch('');
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-muted text-xs">
                              <div className="font-medium truncate">{co.razao_social}</div>
                              <div className="text-muted-foreground font-mono">{formatCnpj(co.cnpj)} · {co.municipio}/{co.uf}</div>
                            </button>
                          ))}
                          {companies.length === 0 && (
                            <div className="text-xs text-muted-foreground p-2 text-center">
                              Nenhuma empresa cadastrada. Clique em "Nova".
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <TicketIcon className="h-3.5 w-3.5" /> Vincular a chamado (opcional)
                  </label>
                  {newTask.ticket_id ? (() => {
                    const tk = tickets.find(x => x.id === newTask.ticket_id);
                    return (
                      <div className="flex items-center justify-between gap-2 border rounded-md px-2 py-1.5 bg-muted/40">
                        <div className="text-xs truncate">
                          <span className="font-mono text-primary">#{tk?.number}</span> {tk?.title}
                        </div>
                        <button type="button" onClick={() => applyTicket(null)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })() : (
                    <>
                      <Input placeholder="Buscar chamado por número ou título..." value={ticketSearch}
                        onChange={e => setTicketSearch(e.target.value)} className="h-8" />
                      {ticketSearch.trim() && (
                        <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                          {tickets.filter(tk => {
                            const q = ticketSearch.toLowerCase();
                            return String(tk.number).includes(q) || tk.title.toLowerCase().includes(q);
                          }).slice(0, 10).map(tk => (
                            <button key={tk.id} type="button"
                              onClick={() => { applyTicket(tk); setTicketSearch(''); }}
                              className="w-full text-left px-2 py-1.5 hover:bg-muted text-xs">
                              <span className="font-mono text-primary">#{tk.number}</span> {tk.title}
                              <span className="text-muted-foreground ml-1">· {tk.status}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {view === 'empresas' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Tipo de serviço <span className="text-destructive">*</span>
                  </label>
                  <Select value={newTask.tipo_servico || ''} onValueChange={v => setNewTask(s => ({ ...s, tipo_servico: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o tipo de serviço" /></SelectTrigger>
                    <SelectContent>
                      {TIPO_SERVICO_OPTIONS.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Input placeholder="Título" value={newTask.titulo}
                onChange={e => setNewTask(s => ({ ...s, titulo: e.target.value }))} />
              <Textarea placeholder="Descrição" rows={3} value={newTask.descricao}
                onChange={e => setNewTask(s => ({ ...s, descricao: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Select value={newTask.status} onValueChange={v => setNewTask(s => ({ ...s, status: v as Status }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={newTask.prioridade} onValueChange={v => setNewTask(s => ({ ...s, prioridade: v as Prioridade }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIO_CFG) as Prioridade[]).map(p => (
                      <SelectItem key={p} value={p}>{PRIO_CFG[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="date" value={newTask.data_prevista}
                  onChange={e => setNewTask(s => ({ ...s, data_prevista: e.target.value }))} />
                <Select value={newTask.responsavel_id || 'self'} onValueChange={v => setNewTask(s => ({ ...s, responsavel_id: v === 'self' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Eu mesmo</SelectItem>
                    {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button onClick={create} disabled={!newTask.titulo.trim()}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(220px,260px)] gap-3 p-2 h-full min-w-max">
            {COLUMNS.map(col => {
              const items = filtered.filter(t => t.status === col.id);
              return (
                <div
                  key={col.id}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
                  onDragLeave={() => setDragOverCol(c => c === col.id ? null : c)}
                  onDrop={() => {
                    if (draggingId) {
                      const t = tasks.find(x => x.id === draggingId);
                      if (t) void moveTask(t, col.id);
                    }
                    setDraggingId(null);
                    setDragOverCol(null);
                  }}
                  className={cn(
                    'flex flex-col rounded-xl border bg-muted/20 min-h-0 transition-all shadow-sm',
                    dragOverCol === col.id && cn('ring-2 ring-offset-1', col.ring, 'bg-primary/5')
                  )}
                >
                  <div className={cn('px-3 py-2 flex items-center justify-between rounded-t-xl border-b', col.headerBg)}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('h-2 w-2 rounded-full shrink-0', col.dot)} />
                      <h3 className="text-[12px] font-semibold uppercase tracking-wider truncate">{col.label}</h3>
                    </div>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold shrink-0">{items.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                    {items.map(t => {
                      const overdue = isOverdue(t);
                      const tk = t.ticket_id ? tickets.find(x => x.id === t.ticket_id) : null;
                      const co = t.company_id ? companies.find(x => x.id === t.company_id) : null;
                      return (
                        <div
                          key={t.id}
                          draggable={canEdit(t)}
                          onDragStart={() => setDraggingId(t.id)}
                          onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                          onClick={() => setEditing(t)}
                          className={cn(
                            'group bg-card border rounded-md px-2 py-1.5 cursor-pointer hover:shadow-sm hover:border-primary/40 transition-all',
                            canEdit(t) && 'active:cursor-grabbing',
                            overdue && 'border-destructive/50',
                            t.status === 'em_andamento' && 'ring-1 ring-[hsl(var(--brand-blue)/0.4)]',
                          )}
                        >
                          <div className="flex items-start gap-1.5">
                            <span className={cn('mt-1 h-1.5 w-1.5 rounded-full shrink-0',
                              t.prioridade === 'urgente' && 'bg-destructive',
                              t.prioridade === 'alta' && 'bg-warning',
                              t.prioridade === 'media' && 'bg-[hsl(var(--brand-blue))]',
                              t.prioridade === 'baixa' && 'bg-muted-foreground/50',
                            )} />
                            <p className="text-[13px] font-medium leading-snug flex-1 line-clamp-2">{t.titulo}</p>
                            {(canEdit(t) || canDelete(t)) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                  <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground -mr-1">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent onClick={e => e.stopPropagation()}>
                                  {canDelete(t) && (
                                    <DropdownMenuItem onClick={() => removeTask(t)} className="text-destructive">
                                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                          <div className="flex items-end justify-between gap-1.5 mt-1.5 pl-3">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap min-w-0 flex-1">
                              {tk && (
                                <span className="px-1 py-px rounded bg-primary/10 text-primary border border-primary/20 font-mono">
                                  #{tk.number}
                                </span>
                              )}
                              {co && (
                                <span className="px-1 py-px rounded bg-[hsl(var(--brand-blue)/0.1)] text-[hsl(var(--brand-blue))] border border-[hsl(var(--brand-blue)/0.3)] font-medium truncate max-w-full inline-flex items-center gap-0.5">
                                  <Building2 className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{co.nome_fantasia || co.razao_social}</span>
                                </span>
                              )}
                              {t.tipo_servico && (
                                <span className={cn('px-1 py-px rounded font-medium border truncate max-w-full', tipoServicoCls(t.tipo_servico))}>
                                  {tipoServicoLabel(t.tipo_servico)}
                                </span>
                              )}
                              {overdue && (
                                <AlertCircle className="h-3 w-3 text-destructive" />
                              )}
                              {t.data_prevista && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Calendar className="h-2.5 w-2.5" />
                                  {new Date(t.data_prevista + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                </span>
                              )}
                              {(t.comentarios?.length || 0) > 0 && (
                                <span>💬{t.comentarios.length}</span>
                              )}
                            </div>
                            <Avatar className="h-4 w-4 shrink-0">
                              <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                {initials(memberName(t.responsavel_id))}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-6">Vazio</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Detalhes da tarefa</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {editing.company_id && (() => {
                const co = companies.find(x => x.id === editing.company_id);
                if (!co) return null;
                return (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Building2 className="h-3.5 w-3.5 text-[hsl(var(--brand-blue))]" />
                      {co.razao_social}
                    </div>
                    {co.nome_fantasia && <div className="text-muted-foreground">{co.nome_fantasia}</div>}
                    <div className="font-mono text-muted-foreground">{formatCnpj(co.cnpj)}</div>
                    {(co.municipio || co.uf) && (
                      <div className="text-muted-foreground">{co.municipio}{co.uf ? `/${co.uf}` : ''}</div>
                    )}
                  </div>
                );
              })()}
              {editing.company_id && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Tipo de serviço</label>
                  <Select
                    value={editing.tipo_servico || 'none'}
                    disabled={!canEdit(editing)}
                    onValueChange={v => setEditing({ ...editing, tipo_servico: v === 'none' ? null : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não definido</SelectItem>
                      {TIPO_SERVICO_OPTIONS.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Input
                value={editing.titulo}
                disabled={!canEdit(editing)}
                onChange={e => setEditing({ ...editing, titulo: e.target.value })}
              />
              <Textarea
                value={editing.descricao}
                rows={3}
                disabled={!canEdit(editing)}
                onChange={e => setEditing({ ...editing, descricao: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={editing.status}
                  disabled={!canEdit(editing)}
                  onValueChange={v => setEditing({ ...editing, status: v as Status })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={editing.prioridade}
                  disabled={!canEdit(editing)}
                  onValueChange={v => setEditing({ ...editing, prioridade: v as Prioridade })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIO_CFG) as Prioridade[]).map(p => (
                      <SelectItem key={p} value={p}>{PRIO_CFG[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  disabled={!canEdit(editing)}
                  value={editing.data_prevista || ''}
                  onChange={e => setEditing({ ...editing, data_prevista: e.target.value || null })}
                />
                <Select
                  value={editing.responsavel_id || 'none'}
                  disabled={!canEdit(editing)}
                  onValueChange={v => setEditing({ ...editing, responsavel_id: v === 'none' ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem responsável</SelectItem>
                    {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
                <div>Criada por: <strong>{memberName(editing.criado_por)}</strong> em {new Date(editing.created_at).toLocaleString('pt-BR')}</div>
                {editing.last_status_changed_at && (
                  <div>Status alterado por: <strong>{memberName(editing.last_status_changed_by)}</strong> em {new Date(editing.last_status_changed_at).toLocaleString('pt-BR')}</div>
                )}
              </div>

              <div className="border-t pt-2">
                <p className="text-sm font-medium mb-2">Comentários</p>
                <div className="space-y-2 max-h-40 overflow-y-auto mb-2">
                  {(editing.comentarios || []).length === 0 && (
                    <p className="text-xs text-muted-foreground">Sem comentários</p>
                  )}
                  {(editing.comentarios || []).map((c, i) => (
                    <div key={i} className="text-xs bg-muted rounded p-2">
                      <div className="font-medium">{memberName(c.user_id)} <span className="text-muted-foreground font-normal">· {new Date(c.at).toLocaleString('pt-BR')}</span></div>
                      <div>{c.text}</div>
                    </div>
                  ))}
                </div>
                <CommentBox onSend={text => addComment(editing, text)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Fechar</Button>
              {canEdit(editing) && (
                <Button onClick={() => updateTask({
                  titulo: editing.titulo,
                  descricao: editing.descricao,
                  status: editing.status,
                  prioridade: editing.prioridade,
                  data_prevista: editing.data_prevista,
                  responsavel_id: editing.responsavel_id,
                  tipo_servico: editing.tipo_servico,
                  last_status_changed_by: user?.id,
                  last_status_changed_at: new Date().toISOString(),
                })}>Salvar</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <NewCompanyDialog
        open={showNewCompany}
        onOpenChange={setShowNewCompany}
        tenantId={tenantId}
        userId={user?.id}
        existingCompanies={companies}
        onCreated={(co) => {
          setCompanies(prev => [co, ...prev.filter(c => c.id !== co.id)].sort((a, b) => a.razao_social.localeCompare(b.razao_social)));
          setNewTask(s => ({
            ...s,
            company_id: co.id,
            titulo: s.titulo.trim() ? s.titulo : (co.nome_fantasia || co.razao_social),
          }));
          setShowNewCompany(false);
        }}
      />
    </div>
  );
}

function CommentBox({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="flex gap-2">
      <Input value={text} onChange={e => setText(e.target.value)} placeholder="Escreva um comentário..."
        onKeyDown={e => { if (e.key === 'Enter') { onSend(text); setText(''); } }} />
      <Button size="sm" onClick={() => { onSend(text); setText(''); }} disabled={!text.trim()}>Enviar</Button>
    </div>
  );
}

interface NewCompanyDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string | null | undefined;
  userId: string | undefined;
  existingCompanies: Company[];
  onCreated: (co: Company) => void;
}

function NewCompanyDialog({ open, onOpenChange, tenantId, userId, existingCompanies, onCreated }: NewCompanyDialogProps) {
  const [mode, setMode] = useState<'cnpj' | 'pdf'>('cnpj');
  const [cnpjInput, setCnpjInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);

  const reset = () => {
    setCnpjInput(''); setData(null); setLoading(false); setMode('cnpj');
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const lookup = async (rawCnpj: string) => {
    const digits = rawCnpj.replace(/\D/g, '');
    if (digits.length !== 14) {
      toast.error('CNPJ deve ter 14 dígitos'); return;
    }
    const dup = existingCompanies.find(c => c.cnpj === digits);
    if (dup) {
      toast.error('Empresa já cadastrada');
      onCreated(dup);
      return;
    }
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('cnpj-lookup', { body: { cnpj: digits } });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res);
    } catch (e: any) {
      toast.error('Falha ao consultar CNPJ: ' + (e?.message || 'erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  const handlePdf = async (file: File) => {
    setLoading(true);
    try {
      const pages = await extractTextFromPDF(file);
      const text = pages.join('\n');
      const m = text.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/);
      if (!m) {
        toast.error('Não consegui localizar o CNPJ no PDF');
        setLoading(false);
        return;
      }
      const digits = m[0].replace(/\D/g, '');
      setCnpjInput(digits);
      await lookup(digits);
    } catch (e: any) {
      toast.error('Falha ao ler PDF: ' + (e?.message || ''));
      setLoading(false);
    }
  };

  const save = async () => {
    if (!data || !tenantId || !userId) return;
    setLoading(true);
    const insertPayload: any = { ...data, tenant_id: tenantId, created_by: userId };
    const { data: row, error } = await supabase.from('companies').insert(insertPayload)
      .select('id, cnpj, razao_social, nome_fantasia, municipio, uf').single();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Empresa cadastrada');
    onCreated(row as any);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
        {!data ? (
          <div className="space-y-3">
            <Tabs value={mode} onValueChange={v => setMode(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="cnpj" className="flex-1 gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Digitar CNPJ
                </TabsTrigger>
                <TabsTrigger value="pdf" className="flex-1 gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Upload do Cartão CNPJ
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === 'cnpj' ? (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">CNPJ (14 dígitos)</label>
                <div className="flex gap-2">
                  <Input value={cnpjInput} onChange={e => setCnpjInput(e.target.value)}
                    placeholder="00.000.000/0000-00" autoFocus />
                  <Button onClick={() => lookup(cnpjInput)} disabled={loading || !cnpjInput.trim()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Os dados (razão social, endereço, sócios, CNAE) serão preenchidos automaticamente via consulta pública.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Selecione o PDF do Cartão CNPJ</label>
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-6 cursor-pointer hover:bg-muted/40 transition-colors">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {loading ? 'Lendo PDF...' : 'Clique para escolher o arquivo PDF'}
                  </span>
                  <input type="file" accept="application/pdf" className="hidden"
                    disabled={loading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handlePdf(f); }} />
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Vamos extrair o CNPJ do PDF e buscar os dados automaticamente.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <div className="font-semibold">{data.razao_social}</div>
              {data.nome_fantasia && <div className="text-muted-foreground text-xs">{data.nome_fantasia}</div>}
              <div className="font-mono text-xs">{formatCnpj(data.cnpj)}</div>
              <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                <div><strong>Situação:</strong> {data.situacao}</div>
                {data.data_abertura && <div><strong>Abertura:</strong> {new Date(data.data_abertura).toLocaleDateString('pt-BR')}</div>}
                {data.porte && <div><strong>Porte:</strong> {data.porte}</div>}
                {data.cnae_principal && (
                  <div><strong>CNAE:</strong> {data.cnae_principal} — {data.cnae_principal_descricao}</div>
                )}
                <div className="pt-1"><strong>Endereço:</strong> {data.logradouro}, {data.numero}{data.complemento ? ` - ${data.complemento}` : ''}, {data.bairro}, {data.municipio}/{data.uf} - CEP {data.cep}</div>
                {data.telefone && <div><strong>Telefone:</strong> {data.telefone}</div>}
                {data.email && <div><strong>Email:</strong> {data.email}</div>}
                {Array.isArray(data.socios) && data.socios.length > 0 && (
                  <div className="pt-1">
                    <strong>Sócios:</strong>
                    <ul className="list-disc pl-4">
                      {data.socios.slice(0, 5).map((s: any, i: number) => (
                        <li key={i}>{s.nome_socio || s.nome || '—'}{s.qualificacao_socio ? ` (${s.qualificacao_socio})` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          {data && (
            <>
              <Button variant="ghost" onClick={() => setData(null)}>Voltar</Button>
              <Button onClick={save} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cadastrar empresa'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

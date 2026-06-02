import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import {
  FolderOpen, Clock, CheckCircle2, AlertTriangle, Ban, XOctagon,
  TrendingUp, BarChart3, Filter, Timer, MessageCircle, Users as UsersIcon, RefreshCw,
  Target,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ----------- Tipagens -----------
interface TicketRow {
  id: string; number: number; title: string;
  urgency: 'baixa' | 'media' | 'alta' | 'critica';
  status: string;
  created_by: string; assignee_id: string | null; requested_for: string | null;
  created_at: string; resolved_at: string | null; closed_at: string | null;
  resolution_due_at: string | null; first_response_due_at: string | null; first_response_at: string | null;
  category_id: string | null;
}
interface CategoryRow { id: string; name: string; color: string }

// ----------- Normalização de status -----------
type CanonStatus = 'aberto' | 'em_andamento' | 'resolvido' | 'fechado' | 'cancelado';
const canon = (s: string): CanonStatus => {
  switch (s) {
    case 'em_atendimento':
    case 'em_andamento':
    case 'aguardando': return 'em_andamento';
    case 'finalizado':
    case 'fechado': return 'fechado';
    case 'resolvido': return 'resolvido';
    case 'cancelado': return 'cancelado';
    default: return 'aberto';
  }
};
const statusLabel: Record<CanonStatus, string> = {
  aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido', fechado: 'Fechado', cancelado: 'Cancelado',
};
const statusColor: Record<CanonStatus, string> = {
  aberto: 'hsl(215, 95%, 56%)', em_andamento: 'hsl(38, 92%, 50%)', resolvido: 'hsl(160, 84%, 39%)', fechado: 'hsl(260, 10%, 50%)', cancelado: 'hsl(0, 72%, 51%)',
};
const urgencyColor: Record<string, string> = {
  baixa: 'hsl(160, 84%, 39%)', media: 'hsl(268, 78%, 58%)', alta: 'hsl(38, 92%, 50%)', critica: 'hsl(328, 88%, 56%)',
};
const urgencyLabel: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };

interface DashboardProps { onOpenTicket?: (ticketId: string) => void; }

export default function Dashboard({ onOpenTicket }: DashboardProps) {
  const { user, isAdmin, isStaff } = useAuth();
  const { tenantId, isTenantAdmin } = useTenant();
  const canViewAll = isAdmin || isStaff || isTenantAdmin;

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, CategoryRow>>({});
  const [loading, setLoading] = useState(true);

  // Filtros
  const today = new Date();
  const ago30 = new Date(); ago30.setDate(ago30.getDate() - 30);
  const [periodPreset, setPeriodPreset] = useState<'7'|'30'|'90'|'all'|'custom'>('30');
  const [from, setFrom] = useState(ago30.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [fStatus, setFStatus] = useState<'all' | CanonStatus>('all');
  const [fUrgency, setFUrgency] = useState<string>('all');
  const [fCreator, setFCreator] = useState<string>('all');
  const [fAssignee, setFAssignee] = useState<string>('all');
  const [fOverdueOnly, setFOverdueOnly] = useState(false);

  // Carregamento
  useEffect(() => {
    if (!user || !tenantId) return;
    let cancelled = false;

    const loadTickets = async (silent = false) => {
      if (!silent) setLoading(true);
      let q = supabase.from('tickets').select('*').eq('tenant_id', tenantId);
      if (!canViewAll) q = q.or(`created_by.eq.${user.id},requested_for.eq.${user.id},assignee_id.eq.${user.id}`);
      const [{ data: tks }, { data: cats }] = await Promise.all([
        q.order('created_at', { ascending: false }).limit(5000),
        supabase.from('ticket_categories').select('id, name, color').eq('tenant_id', tenantId),
      ]);
      if (cancelled) return;
      const ticketRows = (tks as TicketRow[]) || [];
      setTickets(ticketRows);

      const catMap: Record<string, CategoryRow> = {};
      (cats as CategoryRow[] | null)?.forEach(c => { catMap[c.id] = c; });
      setCategories(catMap);

      const userIds = new Set<string>();
      ticketRows.forEach(t => {
        if (t.created_by) userIds.add(t.created_by);
        if (t.requested_for) userIds.add(t.requested_for);
        if (t.assignee_id) userIds.add(t.assignee_id);
      });

      const map: Record<string, string> = {};
      if (userIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', Array.from(userIds));
        profs?.forEach((p: any) => { map[p.user_id] = p.name || 'Usuário'; });
      }
      setProfiles(map);
      if (!silent) setLoading(false);
    };

    void loadTickets();

    // Realtime: recarrega o dashboard quando qualquer chamado do tenant muda
    const ch = supabase
      .channel(`dashboard-tickets-${tenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tickets',
        filter: `tenant_id=eq.${tenantId}`,
      }, () => { void loadTickets(true); })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [user, tenantId, canViewAll]);

  // Atualiza datas pelo preset
  useEffect(() => {
    if (periodPreset === 'all') { setFrom(''); setTo(''); return; }
    if (periodPreset === 'custom') return;
    const d = new Date();
    const days = parseInt(periodPreset, 10);
    const start = new Date(); start.setDate(d.getDate() - days);
    setFrom(start.toISOString().slice(0, 10));
    setTo(d.toISOString().slice(0, 10));
  }, [periodPreset]);

  // Filtragem em memória (rápido e dinâmico)
  const filtered = useMemo(() => {
    const fromMs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    const toMs   = to   ? new Date(to   + 'T23:59:59').getTime() :  Infinity;
    const now = Date.now();
    return tickets.filter(t => {
      const c = new Date(t.created_at).getTime();
      if (c < fromMs || c > toMs) return false;
      const cs = canon(t.status);
      if (fStatus !== 'all' && cs !== fStatus) return false;
      if (fUrgency !== 'all' && t.urgency !== fUrgency) return false;
      if (fCreator !== 'all' && t.created_by !== fCreator) return false;
      if (fAssignee !== 'all' && t.assignee_id !== fAssignee) return false;
      if (fOverdueOnly) {
        const open = !['resolvido', 'fechado', 'cancelado'].includes(cs);
        const overdue = open && t.resolution_due_at && new Date(t.resolution_due_at).getTime() < now;
        if (!overdue) return false;
      }
      return true;
    });
  }, [tickets, from, to, fStatus, fUrgency, fCreator, fAssignee, fOverdueOnly]);

  // KPIs
  const kpis = useMemo(() => {
    const now = Date.now();
    const byStatus: Record<CanonStatus, number> = { aberto: 0, em_andamento: 0, resolvido: 0, fechado: 0, cancelado: 0 };
    let overdue = 0;
    let totalResolutionMs = 0, resolvedCount = 0;
    let totalFirstRespMs = 0, firstRespCount = 0;
    let slaResOk = 0, slaResTotal = 0;
    let slaFrOk = 0, slaFrTotal = 0;
    for (const t of filtered) {
      const cs = canon(t.status); byStatus[cs]++;
      const open = !['resolvido', 'fechado', 'cancelado'].includes(cs);
      if (open && t.resolution_due_at && new Date(t.resolution_due_at).getTime() < now) overdue++;
      if (t.resolved_at) { totalResolutionMs += new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime(); resolvedCount++; }
      if (t.first_response_at) { totalFirstRespMs += new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime(); firstRespCount++; }
      // SLA resolução: conta apenas tickets com SLA definido E (resolvidos OU vencidos)
      if (t.resolution_due_at && (t.resolved_at || !open)) {
        slaResTotal++;
        const ref = t.resolved_at ? new Date(t.resolved_at).getTime() : now;
        if (ref <= new Date(t.resolution_due_at).getTime()) slaResOk++;
      }
      // SLA 1ª resposta
      if (t.first_response_due_at && (t.first_response_at || !open)) {
        slaFrTotal++;
        const ref = t.first_response_at ? new Date(t.first_response_at).getTime() : now;
        if (ref <= new Date(t.first_response_due_at).getTime()) slaFrOk++;
      }
    }
    return {
      total: filtered.length,
      ...byStatus,
      overdue,
      avgResolutionH: resolvedCount ? totalResolutionMs / resolvedCount / 3_600_000 : 0,
      avgFirstResponseH: firstRespCount ? totalFirstRespMs / firstRespCount / 3_600_000 : 0,
      uniqueCreators: new Set(filtered.map(t => t.created_by)).size,
      slaResolutionPct: slaResTotal ? (slaResOk / slaResTotal) * 100 : null,
      slaFirstRespPct: slaFrTotal ? (slaFrOk / slaFrTotal) * 100 : null,
    };
  }, [filtered]);

  // Dados de gráficos
  const statusData = useMemo(() => (
    (Object.keys(statusLabel) as CanonStatus[]).map(s => ({ name: statusLabel[s], value: kpis[s], color: statusColor[s] }))
  ), [kpis]);

  const urgencyData = useMemo(() => {
    const m: Record<string, number> = { baixa: 0, media: 0, alta: 0, critica: 0 };
    filtered.forEach(t => { m[t.urgency] = (m[t.urgency] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ name: urgencyLabel[k], value: v, color: urgencyColor[k] }));
  }, [filtered]);

  // Por categoria/setor
  const categoryData = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(t => {
      const key = t.category_id || '__none__';
      m[key] = (m[key] || 0) + 1;
    });
    return Object.entries(m).map(([k, v]) => ({
      name: k === '__none__' ? 'Sem categoria' : (categories[k]?.name || 'Categoria removida'),
      value: v,
      color: k === '__none__' ? 'hsl(260 10% 60%)' : (categories[k]?.color || 'hsl(268, 78%, 58%)'),
    })).sort((a, b) => b.value - a.value);
  }, [filtered, categories]);

  // Status × Prioridade (stacked)
  const statusByUrgencyData = useMemo(() => {
    const buckets: Record<string, any> = {};
    (['baixa','media','alta','critica'] as const).forEach(u => {
      buckets[u] = { name: urgencyLabel[u], aberto: 0, em_andamento: 0, resolvido: 0, fechado: 0, cancelado: 0 };
    });
    filtered.forEach(t => {
      const cs = canon(t.status);
      if (buckets[t.urgency]) buckets[t.urgency][cs]++;
    });
    return Object.values(buckets);
  }, [filtered]);

  // Evolução temporal: aberturas vs resolvidos por dia
  const timelineData = useMemo(() => {
    const days: Record<string, { date: string; abertos: number; resolvidos: number; fechados: number }> = {};
    const ensure = (k: string) => { if (!days[k]) days[k] = { date: k, abertos: 0, resolvidos: 0, fechados: 0 }; return days[k]; };
    filtered.forEach(t => {
      const k = t.created_at.slice(0, 10); ensure(k).abertos++;
      if (t.resolved_at) ensure(t.resolved_at.slice(0, 10)).resolvidos++;
      if (t.closed_at) ensure(t.closed_at.slice(0, 10)).fechados++;
    });
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  }, [filtered]);

  // Ranking criadores (quem mais abriu)
  const creatorRanking = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(t => { m[t.created_by] = (m[t.created_by] || 0) + 1; });
    return Object.entries(m)
      .map(([uid, v]) => ({ name: profiles[uid] || 'Usuário', value: v }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
  }, [filtered, profiles]);

  // Ranking responsáveis (quem mais resolveu)
  const assigneeRanking = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(t => {
      const cs = canon(t.status);
      if ((cs === 'resolvido' || cs === 'fechado') && t.assignee_id) {
        m[t.assignee_id] = (m[t.assignee_id] || 0) + 1;
      }
    });
    return Object.entries(m)
      .map(([uid, v]) => ({ name: profiles[uid] || 'Responsável', value: v }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
  }, [filtered, profiles]);

  // TMA (tempo médio de atendimento) por responsável — em horas
  const assigneeTMA = useMemo(() => {
    const m: Record<string, { sum: number; count: number }> = {};
    filtered.forEach(t => {
      if (t.assignee_id && t.resolved_at) {
        const ms = new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime();
        if (!m[t.assignee_id]) m[t.assignee_id] = { sum: 0, count: 0 };
        m[t.assignee_id].sum += ms;
        m[t.assignee_id].count++;
      }
    });
    return Object.entries(m)
      .map(([uid, { sum, count }]) => ({
        name: profiles[uid] || 'Responsável',
        value: +(sum / count / 3_600_000).toFixed(1),
      }))
      .sort((a, b) => a.value - b.value).slice(0, 10);
  }, [filtered, profiles]);

  const peopleOptions = useMemo(() => Object.entries(profiles).map(([id, n]) => ({ id, name: n })), [profiles]);

  // ---------- Render ----------
  if (loading && tickets.length === 0) {
    return <div className="text-[13px] text-muted-foreground">Carregando dashboard…</div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">
            Dashboard de Chamados
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            {canViewAll ? 'Visão completa do tenant' : 'Seus chamados'} · {filtered.length} de {tickets.length}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="h-9 text-[12px]">
          <RefreshCw className="h-3.5 w-3.5 mr-2" /> Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[13px] font-semibold text-foreground">Filtros</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground font-medium">Período</label>
            <Select value={periodPreset} onValueChange={(v: any) => setPeriodPreset(v)}>
              <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {periodPreset === 'custom' && <>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium">De</label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 text-[12px] mt-1" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium">Até</label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 text-[12px] mt-1" />
            </div>
          </>}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium">Status</label>
            <Select value={fStatus} onValueChange={(v: any) => setFStatus(v)}>
              <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(Object.keys(statusLabel) as CanonStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground font-medium">Prioridade</label>
            <Select value={fUrgency} onValueChange={setFUrgency}>
              <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(urgencyLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {canViewAll && <>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium">Solicitante</label>
              <Select value={fCreator} onValueChange={setFCreator}>
                <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {peopleOptions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium">Responsável</label>
              <Select value={fAssignee} onValueChange={setFAssignee}>
                <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {peopleOptions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>}
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer h-9">
              <input type="checkbox" checked={fOverdueOnly} onChange={e => setFOverdueOnly(e.target.checked)} />
              Apenas atrasados
            </label>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={BarChart3} color="text-foreground" bg="bg-muted" value={kpis.total} label="Total" />
        <KpiCard icon={FolderOpen} color="text-primary" bg="bg-primary/10" value={kpis.aberto} label="Abertos" />
        <KpiCard icon={Clock} color="text-warning" bg="bg-warning/10" value={kpis.em_andamento} label="Em andamento" />
        <KpiCard icon={CheckCircle2} color="text-success" bg="bg-success/10" value={kpis.resolvido} label="Resolvidos" />
        <KpiCard icon={XOctagon} color="text-muted-foreground" bg="bg-muted" value={kpis.fechado} label="Fechados" />
        <KpiCard icon={Ban} color="text-destructive" bg="bg-destructive/10" value={kpis.cancelado} label="Cancelados" />
        <KpiCard icon={AlertTriangle} color="text-destructive" bg="bg-destructive/10" value={kpis.overdue} label="Atrasados" />
        <KpiCard icon={UsersIcon} color="text-primary" bg="bg-primary/10" value={kpis.uniqueCreators} label="Solicitantes" />
        <KpiCard icon={Timer} color="text-warning" bg="bg-warning/10" value={kpis.avgResolutionH.toFixed(1) + 'h'} label="Resolução média" />
        <KpiCard icon={MessageCircle} color="text-primary" bg="bg-primary/10" value={kpis.avgFirstResponseH.toFixed(1) + 'h'} label="1ª resposta média" />
        <KpiCard
          icon={Target}
          color={kpis.slaResolutionPct === null ? 'text-muted-foreground' : kpis.slaResolutionPct >= 90 ? 'text-success' : kpis.slaResolutionPct >= 70 ? 'text-warning' : 'text-destructive'}
          bg={kpis.slaResolutionPct === null ? 'bg-muted' : kpis.slaResolutionPct >= 90 ? 'bg-success/10' : kpis.slaResolutionPct >= 70 ? 'bg-warning/10' : 'bg-destructive/10'}
          value={kpis.slaResolutionPct === null ? '—' : kpis.slaResolutionPct.toFixed(0) + '%'}
          label="SLA resolução"
        />
        <KpiCard
          icon={Target}
          color={kpis.slaFirstRespPct === null ? 'text-muted-foreground' : kpis.slaFirstRespPct >= 90 ? 'text-success' : kpis.slaFirstRespPct >= 70 ? 'text-warning' : 'text-destructive'}
          bg={kpis.slaFirstRespPct === null ? 'bg-muted' : kpis.slaFirstRespPct >= 90 ? 'bg-success/10' : kpis.slaFirstRespPct >= 70 ? 'bg-warning/10' : 'bg-destructive/10'}
          value={kpis.slaFirstRespPct === null ? '—' : kpis.slaFirstRespPct.toFixed(0) + '%'}
          label="SLA 1ª resposta"
        />
      </div>

      {/* Gráficos linha 1 */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
        <ChartCard title="Por status">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusData.filter(d => d.value > 0)} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Por prioridade">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={urgencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {urgencyData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>

      {/* Categoria + Status × Prioridade */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
        <ChartCard title="Por categoria / setor">
          {categoryData.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-[12px] text-muted-foreground text-center px-6">
              Nenhuma categoria cadastrada ainda.<br />
              Configure em <span className="font-medium text-foreground">Chamados → Configurações</span>.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {categoryData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Status por prioridade">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={statusByUrgencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="aberto" stackId="s" fill={statusColor.aberto} name={statusLabel.aberto} />
              <Bar dataKey="em_andamento" stackId="s" fill={statusColor.em_andamento} name={statusLabel.em_andamento} />
              <Bar dataKey="resolvido" stackId="s" fill={statusColor.resolvido} name={statusLabel.resolvido} />
              <Bar dataKey="fechado" stackId="s" fill={statusColor.fechado} name={statusLabel.fechado} />
              <Bar dataKey="cancelado" stackId="s" fill={statusColor.cancelado} name={statusLabel.cancelado} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Evolução temporal */}
      <ChartCard title="Evolução: aberturas × resolvidos × fechados">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timelineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="abertos" stroke={statusColor.aberto} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="resolvidos" stroke={statusColor.resolvido} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="fechados" stroke={statusColor.fechado} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Rankings */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
        <ChartCard title="Top solicitantes (mais abriram chamados)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={creatorRanking} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(268, 78%, 58%)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top responsáveis (mais resolveram)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={assigneeRanking} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(328, 88%, 56%)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* TMA por responsável */}
      <ChartCard title="Tempo médio de atendimento por responsável (horas, do menor ao maior)">
        {assigneeTMA.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-[12px] text-muted-foreground">
            Sem chamados resolvidos com responsável atribuído no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, assigneeTMA.length * 36)}>
            <BarChart data={assigneeTMA} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
              <Tooltip formatter={(v: any) => `${v}h`} />
              <Bar dataKey="value" fill="hsl(var(--warning))" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[15px] font-semibold text-foreground">Chamados (resultado dos filtros)</h2>
          </div>
          <span className="text-[12px] text-muted-foreground tabular-nums">{filtered.length} resultados</span>
        </div>
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-muted-foreground">Nenhum chamado encontrado</div>
          ) : (
            <div className="divide-y divide-border max-h-[480px] overflow-auto">
              {filtered.slice(0, 50).map(t => {
                const cs = canon(t.status);
                const overdue = !['resolvido','fechado','cancelado'].includes(cs) && t.resolution_due_at && new Date(t.resolution_due_at).getTime() < Date.now();
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenTicket?.(t.id)}
                    className="w-full text-left flex items-center justify-between px-5 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        <span className="text-muted-foreground font-mono text-[11px]">#{t.number}</span>
                        <span className="mx-2 text-border">·</span>
                        {t.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {profiles[t.created_by] || 'Usuário'} · {new Date(t.created_at).toLocaleDateString('pt-BR')}
                        {overdue && <span className="ml-2 text-destructive font-semibold">· ATRASADO</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="badge-status" style={{ backgroundColor: urgencyColor[t.urgency] + '22', color: urgencyColor[t.urgency] }}>
                        {urgencyLabel[t.urgency]}
                      </span>
                      <span className="badge-status" style={{ backgroundColor: statusColor[cs] + '22', color: statusColor[cs] }}>
                        {statusLabel[cs]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {filtered.length > 50 && (
            <div className="px-5 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/30 text-center">
              Exibindo 50 de {filtered.length}. Use filtros para refinar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --------- Cards reutilizáveis ---------
function KpiCard({ icon: Icon, color, bg, value, label }: { icon: any; color: string; bg: string; value: number | string; label: string }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
          <Icon className={`h-4.5 w-4.5 ${color}`} strokeWidth={1.8} />
        </div>
      </div>
      <p className="text-[26px] font-extrabold text-foreground tracking-tight leading-none tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-2 font-medium tracking-wide">{label}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-[13px] font-semibold text-foreground mb-3">{title}</h3>
      {children}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Headset, Inbox, Clock, CheckCircle2, Timer, MessageCircle, Users as UsersIcon,
  RefreshCw, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Period = '24h' | '7d' | '30d';

interface ConvRow {
  id: string;
  status: 'novo' | 'em_atendimento' | 'aguardando_cliente' | 'finalizado';
  assignee_id: string | null;
  created_at: string;
  last_message_at: string | null;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  created_at: string;
}

const PERIOD_HOURS: Record<Period, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
const STATUS_LABEL: Record<ConvRow['status'], string> = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando cliente',
  finalizado: 'Finalizado',
};
const STATUS_COLOR: Record<ConvRow['status'], string> = {
  novo: 'hsl(217 91% 60%)',
  em_atendimento: 'hsl(38 92% 50%)',
  aguardando_cliente: 'hsl(270 76% 60%)',
  finalizado: 'hsl(142 71% 45%)',
};

function formatDuration(ms: number) {
  if (!isFinite(ms) || ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

export default function AtendimentoDashboard() {
  const { tenantId } = useTenant();
  const [period, setPeriod] = useState<Period>('7d');
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [agents, setAgents] = useState<Record<string, { name: string; username: string }>>({});

  const periodStart = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() - PERIOD_HOURS[period]);
    return d.toISOString();
  }, [period]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [convsRes, msgsRes, profilesRes] = await Promise.all([
        supabase
          .from('wa_conversations')
          .select('id,status,assignee_id,created_at,last_message_at')
          .eq('tenant_id', tenantId)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: false }),
        supabase
          .from('wa_messages')
          .select('id,conversation_id,direction,created_at')
          .eq('tenant_id', tenantId)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: true })
          .limit(5000),
        supabase.from('profiles').select('user_id,name,username'),
      ]);

      setConversations((convsRes.data || []) as ConvRow[]);
      setMessages((msgsRes.data || []) as MsgRow[]);
      const map: Record<string, { name: string; username: string }> = {};
      (profilesRes.data || []).forEach((p: any) => {
        map[p.user_id] = { name: p.name || p.username, username: p.username };
      });
      setAgents(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period]);

  // Status counts on the FULL list (open ones don't depend on period for "open now")
  const [openNow, setOpenNow] = useState({ novo: 0, em_atendimento: 0, aguardando_cliente: 0 });
  const [resolvedToday, setResolvedToday] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data: openData } = await supabase
        .from('wa_conversations')
        .select('status')
        .eq('tenant_id', tenantId)
        .in('status', ['novo', 'em_atendimento', 'aguardando_cliente']);
      const counts = { novo: 0, em_atendimento: 0, aguardando_cliente: 0 };
      (openData || []).forEach((r: any) => {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      });
      setOpenNow(counts);

      const { count } = await supabase
        .from('wa_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'finalizado')
        .gte('last_message_at', todayStart);
      setResolvedToday(count || 0);
    })();
  }, [tenantId, todayStart, period]);

  const totalNow = openNow.novo + openNow.em_atendimento + openNow.aguardando_cliente;

  // Avg first response (in -> out within same conversation, period messages)
  const avgFirstResponse = useMemo(() => {
    const byConv: Record<string, MsgRow[]> = {};
    messages.forEach(m => {
      (byConv[m.conversation_id] ||= []).push(m);
    });
    const diffs: number[] = [];
    Object.values(byConv).forEach(arr => {
      const firstIn = arr.find(m => m.direction === 'in');
      if (!firstIn) return;
      const firstOut = arr.find(m => m.direction === 'out' && new Date(m.created_at) > new Date(firstIn.created_at));
      if (!firstOut) return;
      diffs.push(new Date(firstOut.created_at).getTime() - new Date(firstIn.created_at).getTime());
    });
    if (!diffs.length) return 0;
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }, [messages]);

  // Avg resolution: created_at -> last_message_at for finalizado
  const avgResolution = useMemo(() => {
    const finalized = conversations.filter(c => c.status === 'finalizado' && c.last_message_at);
    if (!finalized.length) return 0;
    const sum = finalized.reduce((acc, c) => acc + (new Date(c.last_message_at!).getTime() - new Date(c.created_at).getTime()), 0);
    return sum / finalized.length;
  }, [conversations]);

  // Daily volume (last N days)
  const dailyVolume = useMemo(() => {
    const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;
    const buckets: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
    }
    conversations.forEach(c => {
      const key = c.created_at.slice(0, 10);
      if (key in buckets) buckets[key]++;
    });
    return Object.entries(buckets).map(([date, count]) => ({
      date: new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      total: count,
    }));
  }, [conversations, period]);

  // Status distribution (period)
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    conversations.forEach(c => {
      counts[c.status] = (counts[c.status] || 0) + 1;
    });
    return Object.entries(counts).map(([k, v]) => ({
      name: STATUS_LABEL[k as ConvRow['status']] || k,
      value: v,
      color: STATUS_COLOR[k as ConvRow['status']] || 'hsl(var(--muted-foreground))',
    }));
  }, [conversations]);

  // Agent ranking (by conversations assigned in period)
  const agentRanking = useMemo(() => {
    const counts: Record<string, number> = {};
    conversations.forEach(c => {
      if (c.assignee_id) counts[c.assignee_id] = (counts[c.assignee_id] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([uid, count]) => ({
        name: agents[uid]?.name || agents[uid]?.username || 'Atendente',
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [conversations, agents]);

  const totalInPeriod = conversations.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Headset className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Dashboard de Atendimento</h1>
            <p className="text-sm text-muted-foreground">Métricas operacionais da Central de Atendimento</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['24h', '7d', '30d'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  period === p ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                )}
              >
                {p === '24h' ? '24h' : p === '7d' ? '7 dias' : '30 dias'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={Inbox} label="Em aberto agora" value={totalNow} color="text-primary" bg="bg-primary/10" />
        <KpiCard icon={MessageCircle} label="Em atendimento" value={openNow.em_atendimento} color="text-amber-600" bg="bg-amber-500/10" />
        <KpiCard icon={Clock} label="Aguardando cliente" value={openNow.aguardando_cliente} color="text-purple-600" bg="bg-purple-500/10" />
        <KpiCard icon={CheckCircle2} label="Resolvidas hoje" value={resolvedToday} color="text-emerald-600" bg="bg-emerald-500/10" />
      </div>

      {/* SLA cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Timer className="h-4 w-4" /> Tempo médio de 1ª resposta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatDuration(avgFirstResponse)}</p>
            <p className="text-xs text-muted-foreground mt-1">Período selecionado</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Tempo médio de resolução
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatDuration(avgResolution)}</p>
            <p className="text-xs text-muted-foreground mt-1">Conversas finalizadas no período</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Volume total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalInPeriod}</p>
            <p className="text-xs text-muted-foreground mt-1">Conversas iniciadas no período</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Volume diário</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyVolume}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Sem dados no período</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {statusDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent ranking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UsersIcon className="h-4 w-4" /> Atendentes mais ativos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agentRanking.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa atribuída no período</p>
          ) : (
            <div className="space-y-2">
              {agentRanking.map((a, i) => {
                const pct = (a.count / agentRanking[0].count) * 100;
                return (
                  <div key={a.name + i} className="flex items-center gap-3">
                    <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center text-xs shrink-0">
                      {i + 1}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{a.name}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">{a.count}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, color, bg,
}: {
  icon: any; label: string; value: number | string; color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', bg, color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

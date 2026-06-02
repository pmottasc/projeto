import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, MessageSquare, FileSpreadsheet } from 'lucide-react';

interface TenantLite {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
}

interface PlanLite {
  id: string;
  name: string;
  max_conversions_per_month: number;
  max_ai_messages_per_month: number;
}

interface UsageRow {
  tenant_id: string;
  counter_key: string;
  count: number;
}

interface Props {
  tenants: TenantLite[];
}

const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const pct = (used: number, limit: number) => {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
};

const barTone = (p: number) => {
  if (p >= 90) return 'destructive';
  if (p >= 70) return 'warning';
  return 'ok';
};

export default function TenantUsagePanel({ tenants }: Props) {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const period = currentPeriod();

  const load = async () => {
    setLoading(true);
    const [{ data: planData }, { data: usageData }] = await Promise.all([
      supabase.from('plans').select('id,name,max_conversions_per_month,max_ai_messages_per_month'),
      supabase.from('tenant_usage_counters').select('tenant_id,counter_key,count').eq('period_month', period),
    ]);
    setPlans((planData || []) as PlanLite[]);
    setUsage((usageData || []) as UsageRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tenants.length]);

  const planById = useMemo(() => Object.fromEntries(plans.map(p => [p.id, p])), [plans]);
  const usageByTenant = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    usage.forEach(u => {
      map[u.tenant_id] = map[u.tenant_id] || {};
      map[u.tenant_id][u.counter_key] = u.count;
    });
    return map;
  }, [usage]);

  const totals = useMemo(() => {
    let conv = 0, msgs = 0;
    usage.forEach(u => {
      if (u.counter_key === 'conversions') conv += u.count;
      if (u.counter_key === 'ai_messages') msgs += u.count;
    });
    return { conv, msgs };
  }, [usage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Período</p>
            <p className="text-lg font-bold">{period}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-blue-500" />
          <div>
            <p className="text-xs text-muted-foreground">Conversões totais (mês)</p>
            <p className="text-lg font-bold">{totals.conv}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <MessageSquare className="h-8 w-8 text-emerald-500" />
          <div>
            <p className="text-xs text-muted-foreground">Mensagens IA totais (mês)</p>
            <p className="text-lg font-bold">{totals.msgs}</p>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-5 border-b">
          <h2 className="text-lg font-semibold">Consumo por tenant — {period}</h2>
          <p className="text-xs text-muted-foreground">Acompanhe quem está perto de estourar o limite do plano.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead className="min-w-[220px]">Conversões</TableHead>
              <TableHead className="min-w-[220px]">Mensagens IA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map(t => {
              const plan = t.plan_id ? planById[t.plan_id] : null;
              const convUsed = usageByTenant[t.id]?.conversions || 0;
              const msgUsed = usageByTenant[t.id]?.ai_messages || 0;
              const convLimit = plan?.max_conversions_per_month || 0;
              const msgLimit = plan?.max_ai_messages_per_month || 0;
              const convPct = pct(convUsed, convLimit);
              const msgPct = pct(msgUsed, msgLimit);
              const convTone = barTone(convPct);
              const msgTone = barTone(msgPct);
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-[10px] text-muted-foreground">{t.slug}</div>
                  </TableCell>
                  <TableCell>
                    {plan ? <Badge variant="secondary">{plan.name}</Badge> : <Badge variant="outline">Sem plano</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>{convUsed} / {convLimit || '∞'}</span>
                      {convLimit > 0 && (
                        <span className={
                          convTone === 'destructive' ? 'text-destructive font-semibold' :
                          convTone === 'warning' ? 'text-amber-500 font-semibold' :
                          'text-muted-foreground'
                        }>{convPct}%</span>
                      )}
                    </div>
                    {convLimit > 0 && <Progress value={convPct} className="h-2" />}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>{msgUsed} / {msgLimit || '∞'}</span>
                      {msgLimit > 0 && (
                        <span className={
                          msgTone === 'destructive' ? 'text-destructive font-semibold' :
                          msgTone === 'warning' ? 'text-amber-500 font-semibold' :
                          'text-muted-foreground'
                        }>{msgPct}%</span>
                      )}
                    </div>
                    {msgLimit > 0 && <Progress value={msgPct} className="h-2" />}
                  </TableCell>
                </TableRow>
              );
            })}
            {!tenants.length && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-10">
                  Nenhum tenant cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, FileText, Plus, AlertTriangle, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface BillingRow {
  id: string;
  tenant_id: string;
  plan_id: string | null;
  monthly_amount_cents: number;
  billing_day: number;
  status: 'aguardando_pagamento' | 'em_dia' | 'atrasado' | 'suspenso' | 'cancelado' | 'isento';
  next_invoice_date: string | null;
  payment_pix_key: string;
  payment_bank_info: string;
  payment_instructions: string;
  notes: string;
  billing_exempt: boolean;
  tenant_name?: string;
  plan_name?: string;
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  reference_month: string;
  amount_cents: number;
  due_date: string;
  paid_at: string | null;
  status: 'pendente' | 'paga' | 'vencida' | 'cancelada' | 'isenta';
  payment_method: string;
  receipt_url: string;
  notes: string;
  tenant_name?: string;
}

const STATUS_VARIANT: Record<BillingRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  em_dia: 'default',
  aguardando_pagamento: 'secondary',
  atrasado: 'destructive',
  suspenso: 'destructive',
  cancelado: 'outline',
  isento: 'outline',
};

const STATUS_LABEL: Record<BillingRow['status'], string> = {
  em_dia: 'Em dia',
  aguardando_pagamento: 'Aguardando pgto.',
  atrasado: 'Atrasado',
  suspenso: 'Suspenso',
  cancelado: 'Cancelado',
  isento: 'Isento',
};

const INV_VARIANT: Record<InvoiceRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  paga: 'default',
  pendente: 'secondary',
  vencida: 'destructive',
  cancelada: 'outline',
  isenta: 'outline',
};

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR');
}

export default function BillingPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [billings, setBillings] = useState<BillingRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [editing, setEditing] = useState<BillingRow | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<InvoiceRow | null>(null);
  const [payMethod, setPayMethod] = useState('pix');
  const [payReceipt, setPayReceipt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, iRes, tRes, pRes] = await Promise.all([
      supabase.from('tenant_billing').select('*'),
      supabase.from('tenant_invoices').select('*').order('due_date', { ascending: false }).limit(200),
      supabase.from('tenants').select('id, name'),
      supabase.from('plans').select('id, name'),
    ]);
    const tenantMap = new Map((tRes.data || []).map((t: any) => [t.id, t.name]));
    const planMap = new Map((pRes.data || []).map((p: any) => [p.id, p.name]));
    setBillings((bRes.data || []).map((b: any) => ({
      ...b,
      tenant_name: tenantMap.get(b.tenant_id) || b.tenant_id,
      plan_name: b.plan_id ? planMap.get(b.plan_id) : '—',
    })));
    setInvoices((iRes.data || []).map((i: any) => ({
      ...i,
      tenant_name: tenantMap.get(i.tenant_id) || i.tenant_id,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSaveBilling = async () => {
    if (!editing) return;
    const { error } = await supabase
      .from('tenant_billing')
      .update({
        monthly_amount_cents: editing.billing_exempt ? 0 : editing.monthly_amount_cents,
        billing_day: editing.billing_day,
        payment_pix_key: editing.payment_pix_key,
        payment_bank_info: editing.payment_bank_info,
        payment_instructions: editing.payment_instructions,
        notes: editing.notes,
        billing_exempt: editing.billing_exempt,
        status: editing.billing_exempt ? 'isento' : editing.status,
      })
      .eq('id', editing.id);
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Faturamento atualizado' });
    setEditing(null);
    void load();
  };

  const handleGenerateInvoice = async (tenantId: string) => {
    const { error } = await supabase.rpc('generate_invoice_for_tenant', { _tenant_id: tenantId });
    if (error) { toast({ title: 'Erro ao gerar fatura', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Fatura gerada' });
    void load();
  };

  const handleMarkPaid = async () => {
    if (!payingInvoice) return;
    const { error } = await supabase.rpc('mark_invoice_paid', {
      _invoice_id: payingInvoice.id,
      _method: payMethod,
      _receipt: payReceipt,
    });
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Pagamento confirmado', description: 'Cliente liberado e próxima fatura gerada.' });
    setPayingInvoice(null); setPayReceipt(''); setPayMethod('pix');
    void load();
  };

  const handleCheckOverdue = async () => {
    const { data, error } = await supabase.rpc('check_overdue_invoices', { _tolerance_days: 5 });
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Verificação concluída', description: JSON.stringify(data) });
    void load();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const pendingInvoices = invoices.filter(i => i.status === 'pendente' || i.status === 'vencida');
  const totalPending = pendingInvoices.reduce((s, i) => s + i.amount_cents, 0);
  const monthlyRevenue = billings.filter(b => b.status === 'em_dia').reduce((s, b) => s + b.monthly_amount_cents, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Receita mensal recorrente</div>
          <div className="text-2xl font-bold">{formatBRL(monthlyRevenue)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">A receber (pendentes)</div>
          <div className="text-2xl font-bold">{formatBRL(totalPending)}</div>
          <div className="text-xs text-muted-foreground">{pendingInvoices.length} fatura(s)</div>
        </Card>
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Verificar vencimentos</div>
            <div className="text-xs text-muted-foreground">Marca vencidas e suspende após 5 dias</div>
          </div>
          <Button size="sm" onClick={handleCheckOverdue}>
            <RefreshCw className="h-4 w-4 mr-1" /> Rodar
          </Button>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Faturamento por Tenant</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Dia</TableHead>
              <TableHead>Próxima fatura</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billings.map(b => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.tenant_name}</TableCell>
                <TableCell>{b.plan_name}</TableCell>
                <TableCell>{formatBRL(b.monthly_amount_cents)}</TableCell>
                <TableCell>{b.billing_day}</TableCell>
                <TableCell>{formatDate(b.next_invoice_date)}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => handleGenerateInvoice(b.tenant_id)}>
                    <Plus className="h-3 w-3 mr-1" /> Fatura
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Editar</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Faturas (últimas 200)
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Pago em</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(i => (
              <TableRow key={i.id}>
                <TableCell>{i.tenant_name}</TableCell>
                <TableCell>{i.reference_month}</TableCell>
                <TableCell>{formatBRL(i.amount_cents)}</TableCell>
                <TableCell>
                  {formatDate(i.due_date)}
                  {i.status === 'vencida' && <AlertTriangle className="h-3 w-3 text-destructive inline ml-1" />}
                </TableCell>
                <TableCell>{i.paid_at ? new Date(i.paid_at).toLocaleDateString('pt-BR') : '-'}</TableCell>
                <TableCell><Badge variant={INV_VARIANT[i.status]}>{i.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {(i.status === 'pendente' || i.status === 'vencida') && (
                    <Button size="sm" onClick={() => setPayingInvoice(i)}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Marcar paga
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Dialog editar billing */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Editar faturamento — {editing?.tenant_name}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm font-medium">Isento de cobrança</Label>
                  <p className="text-xs text-muted-foreground">Sem mensalidade. Não bloqueia no vencimento.</p>
                </div>
                <Switch
                  checked={editing.billing_exempt}
                  onCheckedChange={(v) => setEditing({ ...editing, billing_exempt: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor mensal (R$)</Label>
                  <Input type="number" step="0.01" value={editing.monthly_amount_cents / 100}
                    onChange={e => setEditing({ ...editing, monthly_amount_cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
                </div>
                <div>
                  <Label>Dia de vencimento</Label>
                  <Input type="number" min={1} max={28} value={editing.billing_day}
                    onChange={e => setEditing({ ...editing, billing_day: parseInt(e.target.value || '10') })} />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editing.status} onValueChange={(v: BillingRow['status']) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aguardando_pagamento">Aguardando pagamento</SelectItem>
                    <SelectItem value="em_dia">Em dia</SelectItem>
                    <SelectItem value="atrasado">Atrasado</SelectItem>
                    <SelectItem value="suspenso">Suspenso</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Chave PIX</Label>
                <Input value={editing.payment_pix_key} onChange={e => setEditing({ ...editing, payment_pix_key: e.target.value })} />
              </div>
              <div>
                <Label>Dados bancários</Label>
                <Textarea rows={2} value={editing.payment_bank_info} onChange={e => setEditing({ ...editing, payment_bank_info: e.target.value })} />
              </div>
              <div>
                <Label>Instruções de pagamento</Label>
                <Textarea rows={2} value={editing.payment_instructions} onChange={e => setEditing({ ...editing, payment_instructions: e.target.value })} />
              </div>
              <div>
                <Label>Observações internas</Label>
                <Textarea rows={2} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={handleSaveBilling}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog marcar paga */}
      <Dialog open={!!payingInvoice} onOpenChange={(o) => !o && setPayingInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar pagamento</DialogTitle></DialogHeader>
          {payingInvoice && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {payingInvoice.tenant_name} — {payingInvoice.reference_month} — {formatBRL(payingInvoice.amount_cents)}
              </p>
              <div>
                <Label>Método</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comprovante (URL ou observação)</Label>
                <Input value={payReceipt} onChange={e => setPayReceipt(e.target.value)} placeholder="opcional" />
              </div>
              <p className="text-xs text-muted-foreground">
                Ao confirmar, o tenant será liberado automaticamente e a próxima fatura será gerada.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingInvoice(null)}>Cancelar</Button>
            <Button onClick={handleMarkPaid}><CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar pagamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

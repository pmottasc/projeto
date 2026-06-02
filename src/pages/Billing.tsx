import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, FileText, Copy, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Billing {
  monthly_amount_cents: number;
  billing_day: number;
  status: string;
  next_invoice_date: string | null;
  payment_pix_key: string;
  payment_bank_info: string;
  payment_instructions: string;
  billing_exempt: boolean;
}

interface Invoice {
  id: string;
  reference_month: string;
  amount_cents: number;
  due_date: string;
  paid_at: string | null;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  em_dia: 'Em dia',
  aguardando_pagamento: 'Aguardando pagamento',
  atrasado: 'Atrasado',
  suspenso: 'Suspenso',
  cancelado: 'Cancelado',
  isento: 'Isento de cobrança',
};

const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: string | null) => d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') : '-';

export default function Billing() {
  const { tenantId, isTenantAdmin } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    void (async () => {
      setLoading(true);
      const [b, i] = await Promise.all([
        supabase.from('tenant_billing').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('tenant_invoices').select('*').eq('tenant_id', tenantId).order('due_date', { ascending: false }),
      ]);
      setBilling(b.data as Billing | null);
      setInvoices((i.data || []) as Invoice[]);
      setLoading(false);
    })();
  }, [tenantId]);

  if (!isTenantAdmin) {
    return <div className="p-6 text-muted-foreground">Apenas administradores podem ver o faturamento.</div>;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const isExempt = !!billing?.billing_exempt;
  const openInvoice = !isExempt && invoices.find(i => i.status === 'pendente' || i.status === 'vencida');

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Faturamento</h1>
        <p className="text-sm text-muted-foreground">Gerencie sua mensalidade e visualize faturas.</p>
      </div>

      {isExempt && (
        <Card className="p-6 border-primary/40 bg-primary/5">
          <h2 className="text-lg font-semibold">Conta isenta de cobrança</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Esta conta não possui mensalidade ativa. Nenhuma fatura é gerada e o acesso não é bloqueado por vencimento.
          </p>
        </Card>
      )}

      {billing && !isExempt && (
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Mensalidade</div>
              <div className="text-2xl font-bold">{fmt(billing.monthly_amount_cents)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Vencimento</div>
              <div className="text-2xl font-bold">Todo dia {billing.billing_day}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <Badge variant={billing.status === 'em_dia' ? 'default' : 'destructive'} className="text-base mt-1">
                {STATUS_LABEL[billing.status] || billing.status}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {openInvoice && billing && (
        <Card className="p-6 border-primary">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="h-5 w-5 text-primary mt-1" />
            <div>
              <h2 className="text-lg font-semibold">Fatura aberta</h2>
              <p className="text-sm text-muted-foreground">
                Referente a {openInvoice.reference_month} — Vencimento: {fmtDate(openInvoice.due_date)}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-3xl font-bold">{fmt(openInvoice.amount_cents)}</div>
            {billing.payment_pix_key && (
              <div className="bg-muted p-3 rounded-md flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Chave PIX</div>
                  <div className="font-mono text-sm">{billing.payment_pix_key}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => {
                  navigator.clipboard.writeText(billing.payment_pix_key);
                  toast({ title: 'PIX copiado' });
                }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
            {billing.payment_bank_info && (
              <div className="bg-muted p-3 rounded-md">
                <div className="text-xs text-muted-foreground mb-1">Dados bancários</div>
                <pre className="text-sm whitespace-pre-wrap font-sans">{billing.payment_bank_info}</pre>
              </div>
            )}
            {billing.payment_instructions && (
              <div className="text-sm text-muted-foreground">{billing.payment_instructions}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Após o pagamento, envie o comprovante para nosso atendimento. A liberação é feita em até 1 dia útil.
            </p>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Histórico de faturas
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referência</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Pago em</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(i => (
              <TableRow key={i.id}>
                <TableCell>{i.reference_month}</TableCell>
                <TableCell>{fmt(i.amount_cents)}</TableCell>
                <TableCell>{fmtDate(i.due_date)}</TableCell>
                <TableCell>{i.paid_at ? new Date(i.paid_at).toLocaleDateString('pt-BR') : '-'}</TableCell>
                <TableCell>
                  <Badge variant={i.status === 'paga' ? 'default' : i.status === 'vencida' ? 'destructive' : 'secondary'}>
                    {i.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma fatura ainda.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

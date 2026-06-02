import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, ShieldAlert, Save, ToggleLeft, DollarSign, Trash2, Palette, Settings } from 'lucide-react';
import TenantFeaturesPanel from '@/components/superadmin/TenantFeaturesPanel';
import WorkLinksPanel from '@/components/superadmin/WorkLinksPanel';
import BillingPanel from '@/components/superadmin/BillingPanel';
import TenantBrandingPanel from '@/components/superadmin/TenantBrandingPanel';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  max_users: number;
  max_conversions_per_month: number;
  max_ai_messages_per_month: number;
  max_storage_mb: number;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'inactive' | 'trial';
  plan_id: string | null;
  contact_email: string;
  contact_phone: string;
  notes: string;
  created_at: string;
  trial_ends_at: string | null;
}

// Métricas de uso movidas para fora — o painel é apenas configuração.

const STATUS_VARIANT: Record<TenantRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  trial: 'secondary',
  suspended: 'destructive',
  inactive: 'outline',
};

const STATUS_LABEL: Record<TenantRow['status'], string> = {
  active: 'Ativo',
  trial: 'Trial',
  suspended: 'Suspenso',
  inactive: 'Inativo',
};

export default function SuperAdmin() {
  const { isPlatformAdmin, loading: tenantLoading } = useTenant();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', slug: '', contact_email: '', contact_phone: '',
    notes: '', plan_id: '', status: 'active' as TenantRow['status'],
    owner_email: '', owner_password: '', owner_name: '',
  });

  const loadData = async () => {
    setLoading(true);
    const [{ data: tenantsData }, { data: plansData }] = await Promise.all([
      supabase.from('tenants').select('*').order('created_at', { ascending: false }),
      supabase.from('plans').select('*').eq('active', true).order('price_cents'),
    ]);
    setTenants((tenantsData || []) as TenantRow[]);
    setPlans((plansData || []) as Plan[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!tenantLoading && isPlatformAdmin) void loadData();
  }, [tenantLoading, isPlatformAdmin]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '', slug: '', contact_email: '', contact_phone: '',
      notes: '', plan_id: plans[0]?.id || '', status: 'active',
      owner_email: '', owner_password: '', owner_name: '',
    });
    setCreateOpen(true);
  };

  const openEdit = (t: TenantRow) => {
    setEditing(t);
    setForm({
      name: t.name, slug: t.slug, contact_email: t.contact_email,
      contact_phone: t.contact_phone, notes: t.notes,
      plan_id: t.plan_id || '', status: t.status,
      owner_email: '', owner_password: '', owner_name: '',
    });
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: 'Campos obrigatórios', description: 'Nome e slug são obrigatórios.', variant: 'destructive' });
      return;
    }

    setSaving(true);

    if (editing) {
      // Edit existing tenant — just update the row
      const { error } = await supabase.from('tenants').update({
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim(),
        notes: form.notes,
        plan_id: form.plan_id || null,
        status: form.status,
      }).eq('id', editing.id);
      setSaving(false);
      if (error) {
        toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Tenant atualizado' });
      setCreateOpen(false);
      void loadData();
      return;
    }

    // Create new tenant + owner via edge function
    if (!form.owner_email.trim() || !form.owner_password.trim()) {
      setSaving(false);
      toast({ title: 'Campos obrigatórios', description: 'Email e senha do owner são obrigatórios.', variant: 'destructive' });
      return;
    }
    if (form.owner_password.length < 6) {
      setSaving(false);
      toast({ title: 'Senha curta', description: 'A senha deve ter ao menos 6 caracteres.', variant: 'destructive' });
      return;
    }

    const { data, error } = await supabase.functions.invoke('create-tenant-with-owner', {
      body: {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim(),
        notes: form.notes,
        plan_id: form.plan_id || null,
        status: form.status,
        owner_email: form.owner_email.trim().toLowerCase(),
        owner_password: form.owner_password,
        owner_name: form.owner_name.trim() || form.owner_email.trim(),
      },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast({
        title: 'Erro ao criar tenant',
        description: (data as any)?.error || error?.message || 'Falha desconhecida',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Tenant criado', description: `Owner: ${form.owner_email}` });
    setCreateOpen(false);
    void loadData();
  };


  const changeStatus = async (t: TenantRow, status: TenantRow['status']) => {
    const { error } = await supabase.from('tenants').update({ status }).eq('id', t.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Status alterado para ${STATUS_LABEL[status]}` });
    void loadData();
  };

  const changePlan = async (t: TenantRow, plan_id: string) => {
    const { error } = await supabase.from('tenants').update({ plan_id }).eq('id', t.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Plano atualizado' });
    void loadData();
  };

  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteSlugConfirm, setDeleteSlugConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const confirmDeleteTenant = async () => {
    if (!deleteTarget) return;
    if (deleteSlugConfirm.trim() !== deleteTarget.slug) {
      toast({ title: 'Confirme o slug do tenant', variant: 'destructive' });
      return;
    }
    if (!deletePassword) {
      toast({ title: 'Digite sua senha', variant: 'destructive' });
      return;
    }
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke('delete-tenant-cascade', {
      body: {
        tenant_id: deleteTarget.id,
        password: deletePassword,
        confirm_slug: deleteSlugConfirm.trim(),
      },
    });
    setDeleting(false);
    if (error || (data as any)?.error) {
      toast({
        title: 'Falha ao excluir tenant',
        description: (data as any)?.error || error?.message || 'Erro desconhecido',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Tenant excluído', description: `Removidos: ${Object.keys((data as any)?.deleted || {}).length} tabelas.` });
    setDeleteTarget(null);
    setDeletePassword('');
    setDeleteSlugConfirm('');
    void loadData();
  };

  const updatePlan = async (planId: string, patch: Partial<Plan>) => {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, ...patch } : p));
  };

  const savePlan = async (plan: Plan) => {
    const { error } = await supabase.from('plans').update({
      name: plan.name,
      price_cents: plan.price_cents,
      max_users: plan.max_users,
      max_conversions_per_month: plan.max_conversions_per_month,
      max_ai_messages_per_month: plan.max_ai_messages_per_month,
      max_storage_mb: plan.max_storage_mb,
    }).eq('id', plan.id);
    if (error) {
      toast({ title: 'Erro ao salvar plano', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Plano "${plan.name}" salvo` });
  };

  if (tenantLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Card className="p-10 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <h2 className="text-lg font-semibold mb-1">Acesso restrito</h2>
        <p className="text-sm text-muted-foreground">Apenas administradores da plataforma podem ver esta página.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho enxuto: o painel é exclusivamente de configuração */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Configurações da Plataforma</h1>
          <p className="text-xs text-muted-foreground">
            Gerencie tenants, planos comerciais, faturamento, recursos e identidade visual.
          </p>
        </div>
      </div>

      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="billing"><DollarSign className="h-4 w-4 mr-1" />Faturamento</TabsTrigger>
          <TabsTrigger value="plans">Planos</TabsTrigger>
          <TabsTrigger value="features"><ToggleLeft className="h-4 w-4 mr-1" />Recursos</TabsTrigger>
          <TabsTrigger value="branding"><Palette className="h-4 w-4 mr-1" />Branding</TabsTrigger>
          <TabsTrigger value="worklinks">Atalhos</TabsTrigger>
        </TabsList>
        <TabsContent value="branding" className="mt-4">
          <TenantBrandingPanel tenants={tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug }))} />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <BillingPanel />
        </TabsContent>
        <TabsContent value="features" className="mt-4">
          <TenantFeaturesPanel tenants={tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug }))} />
        </TabsContent>
        <TabsContent value="worklinks" className="mt-4">
          <WorkLinksPanel tenants={tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug }))} />
        </TabsContent>
        <TabsContent value="tenants" className="mt-4">
      <Card>
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-semibold">Clientes da plataforma</h2>
            <p className="text-xs text-muted-foreground">Gerencie tenants, planos, status e veja métricas de uso.</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} size="sm">
                <Plus className="h-4 w-4 mr-1" /> Novo Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>{editing ? 'Editar tenant' : 'Novo tenant'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nome *</Label>
                    <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Slug *</Label>
                    <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="ex: empresa-x" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email contato</Label>
                    <Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Plano</Label>
                    <Select value={form.plan_id || 'none'} onValueChange={v => setForm({ ...form, plan_id: v === 'none' ? '' : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem plano</SelectItem>
                        {plans.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as TenantRow['status'] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="suspended">Suspenso</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Notas</Label>
                  <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>

                {!editing && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">Conta do Owner</p>
                      <p className="text-[11px] text-muted-foreground">
                        Será criado um usuário admin para acessar este tenant. Os dados ficam isolados por tenant.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Nome</Label>
                        <Input
                          value={form.owner_name}
                          onChange={e => setForm({ ...form, owner_name: e.target.value })}
                          placeholder="Nome do responsável"
                        />
                      </div>
                      <div>
                        <Label>Email *</Label>
                        <Input
                          type="email"
                          value={form.owner_email}
                          onChange={e => setForm({ ...form, owner_email: e.target.value })}
                          placeholder="owner@empresa.com"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Senha *</Label>
                      <Input
                        type="text"
                        value={form.owner_password}
                        onChange={e => setForm({ ...form, owner_password: e.target.value })}
                        placeholder="Mínimo 6 caracteres"
                      />
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map(t => (
              <TableRow key={t.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.slug}{t.contact_email ? ` • ${t.contact_email}` : ''}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Select value={t.status} onValueChange={v => changeStatus(t, v as TenantRow['status'])}>
                    <SelectTrigger className="w-[130px] h-8">
                      <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="suspended">Suspenso</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={t.plan_id || 'none'} onValueChange={v => changePlan(t, v)}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue placeholder="Sem plano" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>Editar</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { setDeleteTarget(t); setDeletePassword(''); setDeleteSlugConfirm(''); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
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
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <Card>
            <div className="p-5 border-b">
              <h2 className="text-lg font-semibold">Planos comerciais</h2>
              <p className="text-xs text-muted-foreground">Edite preço e limites de cada plano oferecido.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Preço (R$)</TableHead>
                  <TableHead>Máx. Usuários</TableHead>
                  <TableHead>Conv./mês</TableHead>
                  <TableHead>Mens. IA/mês</TableHead>
                  <TableHead>Storage (MB)</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Input
                        value={p.name}
                        onChange={e => updatePlan(p.id, { name: e.target.value })}
                        className="h-8 max-w-[200px]"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">{p.slug}</p>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={(p.price_cents / 100).toString()}
                        onChange={e => updatePlan(p.id, { price_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                        className="h-8 w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={p.max_users}
                        onChange={e => updatePlan(p.id, { max_users: parseInt(e.target.value || '0', 10) })}
                        className="h-8 w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={p.max_conversions_per_month}
                        onChange={e => updatePlan(p.id, { max_conversions_per_month: parseInt(e.target.value || '0', 10) })}
                        className="h-8 w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={p.max_ai_messages_per_month ?? 0}
                        onChange={e => updatePlan(p.id, { max_ai_messages_per_month: parseInt(e.target.value || '0', 10) })}
                        className="h-8 w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={p.max_storage_mb}
                        onChange={e => updatePlan(p.id, { max_storage_mb: parseInt(e.target.value || '0', 10) })}
                        className="h-8 w-28"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => savePlan(p)}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!plans.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                      Nenhum plano cadastrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeletePassword(''); setDeleteSlugConfirm(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> Excluir tenant permanentemente
            </DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">{deleteTarget.name} <span className="text-muted-foreground">({deleteTarget.slug})</span></p>
                <p className="text-xs text-muted-foreground mt-1">
                  Esta ação apaga TODOS os dados deste tenant: usuários, tickets, conversas, anexos, faturas, configurações. Não pode ser desfeita.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Digite o slug <code className="bg-muted px-1 rounded">{deleteTarget.slug}</code> para confirmar</Label>
                <Input
                  value={deleteSlugConfirm}
                  onChange={(e) => setDeleteSlugConfirm(e.target.value)}
                  placeholder={deleteTarget.slug}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Sua senha de SuperAdmin</Label>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteTenant}
              disabled={deleting || !deletePassword || deleteSlugConfirm !== (deleteTarget?.slug || '')}
            >
              {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Excluindo...</> : <>Excluir definitivamente</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

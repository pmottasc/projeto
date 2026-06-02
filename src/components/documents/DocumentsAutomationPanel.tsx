import { useEffect, useMemo, useState } from 'react';
import { FileText, KeyRound, Plus, Trash2, Save, Power, AlertCircle, CheckCircle2, Pencil, Phone, Building2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ApiConfig {
  id?: string;
  tenant_id: string;
  provider_name: string;
  provider_type: 'acessorias' | 'custom';
  base_url: string;
  api_token: string;
  auth_header_name: string;
  auth_header_prefix: string;
  endpoint_template: string;
  active: boolean;
}

interface CnpjLink {
  id: string;
  tenant_id: string;
  cnpj: string;
  razao_social: string;
  phone: string;
  external_id: string;
  active: boolean;
  notes: string;
}

// Grouped per CNPJ for display
interface CnpjGroup {
  cnpj: string;
  razao_social: string;
  external_id: string;
  notes: string;
  phones: { id: string; phone: string; active: boolean }[];
}

const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
const formatCnpj = (s: string) => {
  const d = onlyDigits(s).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};
const formatPhone = (s: string) => {
  const d = onlyDigits(s);
  if (!d) return '';
  // (DD) 9XXXX-XXXX  or (DD) XXXX-XXXX
  const noCc = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (noCc.length >= 11) return `(${noCc.slice(0, 2)}) ${noCc.slice(2, 7)}-${noCc.slice(7, 11)}`;
  if (noCc.length === 10) return `(${noCc.slice(0, 2)}) ${noCc.slice(2, 6)}-${noCc.slice(6)}`;
  return d;
};

export default function DocumentsAutomationPanel() {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [links, setLinks] = useState<CnpjLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // new CNPJ form (with multiple phones)
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<{ cnpj: string; razao_social: string; external_id: string; notes: string; phones: string[] }>({
    cnpj: '', razao_social: '', external_id: '', notes: '', phones: [''],
  });

  // edit existing CNPJ group
  const [editing, setEditing] = useState<CnpjGroup | null>(null);
  const [editForm, setEditForm] = useState<{ razao_social: string; external_id: string; notes: string; phones: { id?: string; phone: string; active: boolean }[] } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void load();
  }, [tenantId]);

  async function load() {
    setLoading(true);
    const [cfgRes, linksRes] = await Promise.all([
      supabase.from('accounting_api_config').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('wa_contact_cnpjs').select('*').eq('tenant_id', tenantId).order('razao_social'),
    ]);
    setConfig((cfgRes.data as any) || {
      tenant_id: tenantId, provider_name: 'Acessorias', provider_type: 'acessorias',
      base_url: 'https://api.acessorias.com', api_token: '',
      auth_header_name: 'Authorization', auth_header_prefix: 'Bearer ',
      endpoint_template: '', active: false,
    });
    setLinks((linksRes.data as CnpjLink[]) || []);
    setLoading(false);
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    const payload = { ...config, tenant_id: tenantId };
    const res = config.id
      ? await supabase.from('accounting_api_config').update(payload).eq('id', config.id).select().maybeSingle()
      : await supabase.from('accounting_api_config').insert(payload).select().maybeSingle();
    setSaving(false);
    if (res.error) {
      toast({ title: 'Erro ao salvar', description: res.error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Configuração salva', description: 'A integração foi atualizada.' });
      if (res.data) setConfig(res.data as any);
    }
  }

  // Build grouped view by CNPJ
  const groups: CnpjGroup[] = useMemo(() => {
    const map = new Map<string, CnpjGroup>();
    for (const l of links) {
      const key = onlyDigits(l.cnpj);
      const g = map.get(key);
      if (!g) {
        map.set(key, {
          cnpj: key,
          razao_social: l.razao_social || '',
          external_id: l.external_id || '',
          notes: l.notes || '',
          phones: [{ id: l.id, phone: l.phone, active: l.active }],
        });
      } else {
        g.phones.push({ id: l.id, phone: l.phone, active: l.active });
        if (!g.razao_social && l.razao_social) g.razao_social = l.razao_social;
        if (!g.external_id && l.external_id) g.external_id = l.external_id;
      }
    }
    return [...map.values()].sort((a, b) => (a.razao_social || '').localeCompare(b.razao_social || ''));
  }, [links]);

  const filteredGroups = groups.filter((g) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const sd = onlyDigits(search);
    return g.cnpj.includes(sd) ||
      g.razao_social.toLowerCase().includes(s) ||
      g.phones.some((p) => p.phone.includes(sd));
  });

  async function createGroup() {
    const cnpj = onlyDigits(newForm.cnpj);
    if (cnpj.length !== 14) {
      toast({ title: 'CNPJ inválido', description: 'Informe um CNPJ com 14 dígitos.', variant: 'destructive' });
      return;
    }
    const phones = newForm.phones.map((p) => onlyDigits(p)).filter((p) => p.length >= 10);
    if (!phones.length) {
      toast({ title: 'Telefone inválido', description: 'Adicione ao menos um telefone com DDD + número.', variant: 'destructive' });
      return;
    }
    const rows = phones.map((phone) => ({
      tenant_id: tenantId, cnpj, phone,
      razao_social: newForm.razao_social.trim(),
      external_id: newForm.external_id.trim(),
      notes: newForm.notes.trim(),
      active: true,
    }));
    const res = await supabase.from('wa_contact_cnpjs').upsert(rows, { onConflict: 'tenant_id,cnpj,phone' }).select();
    if (res.error) {
      toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Empresa cadastrada', description: `${rows.length} telefone(s) vinculado(s).` });
    setNewForm({ cnpj: '', razao_social: '', external_id: '', notes: '', phones: [''] });
    setShowNew(false);
    void load();
  }

  function openEdit(g: CnpjGroup) {
    setEditing(g);
    setEditForm({
      razao_social: g.razao_social,
      external_id: g.external_id,
      notes: g.notes,
      phones: g.phones.map((p) => ({ id: p.id, phone: p.phone, active: p.active })),
    });
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
    const cnpj = editing.cnpj;
    const validPhones = editForm.phones.filter((p) => onlyDigits(p.phone).length >= 10);
    if (!validPhones.length) {
      toast({ title: 'Telefone inválido', description: 'A empresa precisa de ao menos um telefone.', variant: 'destructive' });
      return;
    }
    const existingIds = new Set(editing.phones.map((p) => p.id));
    const keptIds = new Set(validPhones.filter((p) => p.id).map((p) => p.id as string));

    // Deletes
    const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
    if (toDelete.length) {
      await supabase.from('wa_contact_cnpjs').delete().in('id', toDelete);
    }
    // Updates (kept) — also update razao_social/external_id/notes across all rows for this CNPJ
    for (const p of validPhones) {
      const phone = onlyDigits(p.phone);
      if (p.id) {
        await supabase.from('wa_contact_cnpjs').update({
          phone, active: p.active,
          razao_social: editForm.razao_social.trim(),
          external_id: editForm.external_id.trim(),
          notes: editForm.notes.trim(),
        }).eq('id', p.id);
      } else {
        await supabase.from('wa_contact_cnpjs').upsert({
          tenant_id: tenantId, cnpj, phone, active: p.active,
          razao_social: editForm.razao_social.trim(),
          external_id: editForm.external_id.trim(),
          notes: editForm.notes.trim(),
        }, { onConflict: 'tenant_id,cnpj,phone' });
      }
    }
    // Sync metadata across all kept rows of this CNPJ
    await supabase.from('wa_contact_cnpjs').update({
      razao_social: editForm.razao_social.trim(),
      external_id: editForm.external_id.trim(),
      notes: editForm.notes.trim(),
    }).eq('tenant_id', tenantId).eq('cnpj', cnpj);

    toast({ title: 'Vínculo atualizado' });
    setEditing(null);
    setEditForm(null);
    void load();
  }

  async function deleteGroup(g: CnpjGroup) {
    if (!confirm(`Remover TODOS os ${g.phones.length} telefone(s) vinculado(s) ao CNPJ ${formatCnpj(g.cnpj)}?`)) return;
    const ids = g.phones.map((p) => p.id);
    const res = await supabase.from('wa_contact_cnpjs').delete().in('id', ids);
    if (!res.error) {
      toast({ title: 'Empresa removida' });
      void load();
    }
  }

  async function togglePhone(id: string, active: boolean) {
    const res = await supabase.from('wa_contact_cnpjs').update({ active: !active }).eq('id', id);
    if (!res.error) setLinks((l) => l.map((x) => x.id === id ? { ...x, active: !active } : x));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      if (i === 0 && /cnpj/i.test(cells[0] || '')) continue; // header
      const [cnpj, razao_social, phone, external_id, notes] = cells;
      const c = onlyDigits(cnpj || '');
      const p = onlyDigits(phone || '');
      if (c.length === 14 && p.length >= 10) {
        rows.push({
          tenant_id: tenantId, cnpj: c, phone: p,
          razao_social: razao_social || '', external_id: external_id || '',
          notes: notes || '', active: true,
        });
      }
    }
    if (!rows.length) {
      toast({ title: 'Nenhuma linha válida', description: 'Verifique o formato: CNPJ;Razão Social;Telefone;ID Externo;Observações', variant: 'destructive' });
      return;
    }
    const res = await supabase.from('wa_contact_cnpjs').upsert(rows, { onConflict: 'tenant_id,cnpj,phone' }).select();
    if (res.error) {
      toast({ title: 'Erro na importação', description: res.error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Importação concluída', description: `${rows.length} registros processados.` });
      void load();
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground p-4">Carregando…</div>;

  return (
    <Tabs defaultValue="vinculos" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="vinculos"><FileText className="h-3.5 w-3.5 mr-1.5" /> Vínculos CNPJ</TabsTrigger>
        <TabsTrigger value="api"><KeyRound className="h-3.5 w-3.5 mr-1.5" /> API Contábil</TabsTrigger>
      </TabsList>

      {/* CNPJ Links */}
      <TabsContent value="vinculos" className="mt-4 space-y-4">
        <Card className="p-6">
          <div className="flex items-start gap-3 mb-6 p-4 bg-muted/40 rounded-lg border">
            <AlertCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Controle de acesso por CNPJ</p>
              <p className="text-sm text-muted-foreground">
                Cada empresa pode ter <strong>vários telefones autorizados</strong> a solicitar documentos pelo WhatsApp.
                O bot também consulta automaticamente os contatos cadastrados na Acessorias em tempo real.
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <Input
              placeholder="🔍 Buscar por CNPJ, razão social ou telefone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md h-11"
            />
            <div className="flex-1" />
            <label className="cursor-pointer">
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
              <span className="inline-flex items-center gap-2 px-4 h-11 text-sm border rounded-md hover:bg-muted transition-colors">
                <Plus className="h-4 w-4" /> Importar CSV
              </span>
            </label>
            <Button onClick={() => setShowNew(true)} className="h-11">
              <Plus className="h-4 w-4 mr-2" /> Nova empresa
            </Button>
          </div>

          <div className="text-xs text-muted-foreground mb-3">
            {filteredGroups.length} de {groups.length} {groups.length === 1 ? 'empresa cadastrada' : 'empresas cadastradas'}
          </div>

          {/* Cards */}
          {filteredGroups.length === 0 ? (
            <div className="border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Nenhuma empresa cadastrada ainda.</p>
              <p className="text-xs mt-1">Clique em "Nova empresa" ou importe um CSV para começar.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredGroups.map((g) => (
                <div key={g.cnpj} className="border rounded-lg p-4 hover:border-primary/40 transition-colors bg-card">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <h4 className="font-semibold text-base truncate">
                          {g.razao_social || <span className="italic text-muted-foreground">Sem razão social</span>}
                        </h4>
                        <Badge variant="outline" className="font-mono text-xs">{formatCnpj(g.cnpj)}</Badge>
                        {g.external_id && (
                          <Badge variant="secondary" className="text-xs">ID: {g.external_id}</Badge>
                        )}
                      </div>
                      {g.notes && <p className="text-xs text-muted-foreground mt-1 ml-6">{g.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(g)} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteGroup(g)} title="Remover">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 ml-6">
                    {g.phones.map((p) => (
                      <div
                        key={p.id}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                          p.active ? 'bg-primary/5 border-primary/20' : 'bg-muted/40 opacity-60'
                        }`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span className="font-mono text-xs">{formatPhone(p.phone)}</span>
                        <Switch
                          checked={p.active}
                          onCheckedChange={() => togglePhone(p.id, p.active)}
                          className="scale-75"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-5 pt-4 border-t">
            <strong>Formato CSV:</strong> CNPJ;Razão Social;Telefone;ID Externo;Observações (separado por <code>;</code> ou <code>,</code> — primeira linha pode ser cabeçalho)
          </p>
        </Card>

        {/* New empresa dialog */}
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Cadastrar nova empresa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>CNPJ *</Label>
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={formatCnpj(newForm.cnpj)}
                    onChange={(e) => setNewForm({ ...newForm, cnpj: e.target.value })}
                    className="h-10 font-mono"
                  />
                </div>
                <div>
                  <Label>Razão Social</Label>
                  <Input
                    placeholder="Nome da empresa"
                    value={newForm.razao_social}
                    onChange={(e) => setNewForm({ ...newForm, razao_social: e.target.value })}
                    className="h-10"
                  />
                </div>
                <div>
                  <Label>ID no sistema contábil (opcional)</Label>
                  <Input
                    placeholder="ID Acessorias"
                    value={newForm.external_id}
                    onChange={(e) => setNewForm({ ...newForm, external_id: e.target.value })}
                    className="h-10"
                  />
                </div>
                <div>
                  <Label>Observações (opcional)</Label>
                  <Input
                    placeholder="Notas internas"
                    value={newForm.notes}
                    onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
                    className="h-10"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Telefones autorizados *</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setNewForm({ ...newForm, phones: [...newForm.phones, ''] })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar telefone
                  </Button>
                </div>
                <div className="space-y-2">
                  {newForm.phones.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Input
                        placeholder="Ex: 48998582959 (DDD + número)"
                        value={p}
                        onChange={(e) => {
                          const arr = [...newForm.phones];
                          arr[idx] = e.target.value;
                          setNewForm({ ...newForm, phones: arr });
                        }}
                        className="h-10 font-mono"
                      />
                      {newForm.phones.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setNewForm({ ...newForm, phones: newForm.phones.filter((_, i) => i !== idx) })}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Adicione todos os números que devem poder solicitar documentos desta empresa.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button onClick={createGroup}><Save className="h-4 w-4 mr-2" /> Cadastrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit empresa dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setEditForm(null); } }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                Editar empresa
                {editing && <span className="ml-2 font-mono text-xs text-muted-foreground">{formatCnpj(editing.cnpj)}</span>}
              </DialogTitle>
            </DialogHeader>
            {editForm && editing && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Razão Social</Label>
                    <Input
                      value={editForm.razao_social}
                      onChange={(e) => setEditForm({ ...editForm, razao_social: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <Label>ID no sistema contábil</Label>
                    <Input
                      value={editForm.external_id}
                      onChange={(e) => setEditForm({ ...editForm, external_id: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Observações</Label>
                    <Input
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      className="h-10"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Telefones autorizados</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditForm({ ...editForm, phones: [...editForm.phones, { phone: '', active: true }] })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar telefone
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {editForm.phones.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input
                          placeholder="DDD + número"
                          value={p.phone}
                          onChange={(e) => {
                            const arr = [...editForm.phones];
                            arr[idx] = { ...arr[idx], phone: e.target.value };
                            setEditForm({ ...editForm, phones: arr });
                          }}
                          className="h-10 font-mono"
                        />
                        <div className="flex items-center gap-2 px-3 h-10 border rounded-md">
                          <Switch
                            checked={p.active}
                            onCheckedChange={(v) => {
                              const arr = [...editForm.phones];
                              arr[idx] = { ...arr[idx], active: v };
                              setEditForm({ ...editForm, phones: arr });
                            }}
                          />
                          <span className="text-xs text-muted-foreground">{p.active ? 'Ativo' : 'Inativo'}</span>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditForm({ ...editForm, phones: editForm.phones.filter((_, i) => i !== idx) })} title="Remover">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditing(null); setEditForm(null); }}>Cancelar</Button>
              <Button onClick={saveEdit}><Save className="h-4 w-4 mr-2" /> Salvar alterações</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* API Config */}
      <TabsContent value="api" className="mt-4 space-y-4">
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Integração com Sistema Contábil</h3>
              <p className="text-xs text-muted-foreground">Credenciais usadas pelo bot para buscar guias e documentos automaticamente.</p>
            </div>
            <div className="flex items-center gap-2">
              <Power className={`h-4 w-4 ${config?.active ? 'text-green-500' : 'text-muted-foreground'}`} />
              <Switch checked={config?.active || false} onCheckedChange={(v) => setConfig({ ...(config!), active: v })} />
              <span className="text-sm">{config?.active ? 'Ativo' : 'Inativo'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Provedor</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={config?.provider_type || 'acessorias'}
                onChange={(e) => {
                  const v = e.target.value as 'acessorias' | 'custom';
                  setConfig({
                    ...(config!),
                    provider_type: v,
                    ...(v === 'acessorias' && !config?.base_url ? { base_url: 'https://api.acessorias.com' } : {}),
                    ...(v === 'acessorias' ? { auth_header_name: 'Authorization', auth_header_prefix: 'Bearer ' } : {}),
                  });
                }}
              >
                <option value="acessorias">Acessorias (api.acessorias.com)</option>
                <option value="custom">Personalizado (template manual)</option>
              </select>
            </div>
            <div>
              <Label>Nome do sistema (rótulo)</Label>
              <Input placeholder="Ex: Acessorias" value={config?.provider_name || ''}
                onChange={(e) => setConfig({ ...(config!), provider_name: e.target.value })} />
            </div>
            <div>
              <Label>URL base da API</Label>
              <Input placeholder="https://api.acessorias.com" value={config?.base_url || ''}
                onChange={(e) => setConfig({ ...(config!), base_url: e.target.value })} />
            </div>
            <div>
              <Label>Token / API Key</Label>
              <Input type="password" placeholder="••••••••" value={config?.api_token || ''}
                onChange={(e) => setConfig({ ...(config!), api_token: e.target.value })} />
              {config?.provider_type === 'acessorias' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Gere seu token na Acessorias em <strong>Engrenagem (canto superior direito) → API Token</strong>.
                </p>
              )}
            </div>
            {config?.provider_type === 'custom' && (
              <>
                <div>
                  <Label>Nome do header de autenticação</Label>
                  <Input placeholder="Authorization" value={config?.auth_header_name || ''}
                    onChange={(e) => setConfig({ ...(config!), auth_header_name: e.target.value })} />
                </div>
                <div>
                  <Label>Prefixo do token</Label>
                  <Input placeholder="Bearer  (com espaço) ou vazio" value={config?.auth_header_prefix || ''}
                    onChange={(e) => setConfig({ ...(config!), auth_header_prefix: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Template do endpoint</Label>
                  <Textarea rows={2} className="font-mono text-xs"
                    placeholder="/documents?cnpj={cnpj}&type={tipo}&period={periodo}"
                    value={config?.endpoint_template || ''}
                    onChange={(e) => setConfig({ ...(config!), endpoint_template: e.target.value })} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Variáveis disponíveis: <code>{'{cnpj}'}</code>, <code>{'{tipo}'}</code>, <code>{'{periodo}'}</code>, <code>{'{external_id}'}</code>
                  </p>
                </div>
              </>
            )}
            {config?.provider_type === 'acessorias' && (
              <div className="md:col-span-2 p-3 bg-muted/40 rounded-md text-xs space-y-1">
                <p><strong>Integração nativa Acessorias.</strong> O bot usa automaticamente:</p>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  <li>Endpoint: <code>GET /deliveries/{'{cnpj}'}/?DtInitial=…&DtFinal=…&attachments=S</code></li>
                  <li>Filtra entregas por tipo (DAS, DARF, GPS, FGTS, CND, holerite…) e competência (MM/AAAA)</li>
                  <li>Pega o anexo mais recente e envia pelo WhatsApp</li>
                </ul>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-xs text-muted-foreground">
              {config?.active ? (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Bot pode buscar documentos automaticamente
                </span>
              ) : (
                <span>Ative quando todas as credenciais estiverem corretas.</span>
              )}
            </div>
            <Button onClick={saveConfig} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Salvando…' : 'Salvar configuração'}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h4 className="font-semibold text-sm mb-2">Como o bot usa essa integração</h4>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Cliente pede um documento no WhatsApp (ex: "manda meu DAS")</li>
            <li>IA pergunta o CNPJ se ainda não souber</li>
            <li>Sistema verifica se o telefone está autorizado para aquele CNPJ (aba "Vínculos")</li>
            <li>Bot chama esta API substituindo as variáveis no template</li>
            <li>Recebe o PDF e envia automaticamente pelo WhatsApp</li>
            <li>Tudo é registrado em log para auditoria</li>
          </ol>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

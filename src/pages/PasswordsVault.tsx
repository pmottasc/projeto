import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Eye, EyeOff, Search, KeyRound, Copy, Shield, FileBadge } from 'lucide-react';
import CertificatesPanel from '@/components/vault/CertificatesPanel';

interface VaultEntry {
  id: string; service_name: string; service_type: string;
  login_email: string; login_username: string; login_password: string;
  notes: string; created_at: string; updated_at: string;
}

const SERVICE_TYPES = [
  { value: 'email', label: 'E-mail' },
  { value: 'discord', label: 'Discord' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'github', label: 'GitHub' },
  { value: 'microsoft', label: 'Microsoft' },
  { value: 'google', label: 'Google' },
  { value: 'sistema', label: 'Sistema' },
  { value: 'servidor', label: 'Servidor' },
  { value: 'banco_dados', label: 'Banco de Dados' },
  { value: 'vpn', label: 'VPN' },
  { value: 'outro', label: 'Outro' },
];

const emptyForm = { service_name: '', service_type: 'outro', login_email: '', login_username: '', login_password: '', notes: '' };

export default function PasswordsVault() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const isTI = user?.role === 'admin';

  useEffect(() => { if (isTI) loadEntries(); }, [isTI]);

  const loadEntries = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('passwords_vault').select('*').order('service_name');
    if (error) toast.error('Erro ao carregar senhas');
    else setEntries((data as VaultEntry[]) || []);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!form.service_name.trim()) { toast.error('Nome do serviço é obrigatório'); return; }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase.from('passwords_vault').update({ service_name: form.service_name, service_type: form.service_type, login_email: form.login_email, login_username: form.login_username, login_password: form.login_password, notes: form.notes }).eq('id', editingId);
      if (error) toast.error('Erro ao atualizar'); else toast.success('Atualizado com sucesso');
    } else {
      const { error } = await supabase.from('passwords_vault').insert({ ...form, created_by: user!.id, tenant_id: requireTenantId(tenantId) } as any);
      if (error) toast.error('Erro ao cadastrar'); else toast.success('Cadastrado com sucesso');
    }
    setSaving(false); setDialogOpen(false); setEditingId(null); setForm(emptyForm); loadEntries();
  };

  const handleEdit = (entry: VaultEntry) => {
    setEditingId(entry.id);
    setForm({ service_name: entry.service_name, service_type: entry.service_type, login_email: entry.login_email, login_username: entry.login_username, login_password: entry.login_password, notes: entry.notes });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir?')) return;
    const { error } = await supabase.from('passwords_vault').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir'); else { toast.success('Excluído'); loadEntries(); }
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const copyToClipboard = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copiado!`); };

  const filtered = entries.filter(e => {
    const matchSearch = !search || e.service_name.toLowerCase().includes(search.toLowerCase()) || e.login_email.toLowerCase().includes(search.toLowerCase()) || e.login_username.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (filterType === 'all' || e.service_type === filterType);
  });

  const getTypeBadge = (type: string) => SERVICE_TYPES.find(t => t.value === type)?.label || type;

  if (!isTI) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <Shield className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-[14px] text-muted-foreground font-medium">Acesso restrito ao perfil TI</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-primary" /> Cofre de Senhas
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">Gerencie credenciais e certificados — acesso exclusivo TI</p>
        </div>
      </div>

      <Tabs defaultValue="senhas" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="senhas"><KeyRound className="h-3.5 w-3.5 mr-1.5" /> Senhas</TabsTrigger>
          <TabsTrigger value="certificados"><FileBadge className="h-3.5 w-3.5 mr-1.5" /> Certificados</TabsTrigger>
        </TabsList>

        <TabsContent value="senhas" className="mt-6 space-y-6">
          <div className="flex justify-end">
            <Button className="h-10 text-[13px] font-semibold px-5" onClick={() => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Nova Credencial
            </Button>
          </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por serviço, e-mail ou usuário..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-10 text-[13px]" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px] h-10 text-[13px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Cards grid */}
      <div>
        {loading ? (
          <div className="bg-card rounded-xl border p-16 text-center text-[13px] text-muted-foreground" style={{ borderColor: 'hsl(220 15% 90% / 0.7)' }}>Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-xl border p-16 text-center" style={{ borderColor: 'hsl(220 15% 90% / 0.7)' }}>
            <Shield className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-[14px] text-muted-foreground font-medium">Nenhuma credencial encontrada</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(entry => (
              <div key={entry.id} className="bg-card rounded-xl border p-5 hover:shadow-md transition-all duration-200" style={{ borderColor: 'hsl(220 15% 90% / 0.7)' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-[14px] font-semibold text-foreground">{entry.service_name}</h3>
                    <span className="badge-status bg-primary/10 text-primary mt-1.5">{getTypeBadge(entry.service_type)}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(entry)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(entry.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="space-y-2.5 text-[12px]">
                  {entry.login_email && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">E-mail</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate max-w-[160px]">{entry.login_email}</span>
                        <button onClick={() => copyToClipboard(entry.login_email, 'E-mail')} className="text-muted-foreground hover:text-primary transition-colors"><Copy className="h-3 w-3" /></button>
                      </div>
                    </div>
                  )}
                  {entry.login_username && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Usuário</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate max-w-[160px]">{entry.login_username}</span>
                        <button onClick={() => copyToClipboard(entry.login_username, 'Usuário')} className="text-muted-foreground hover:text-primary transition-colors"><Copy className="h-3 w-3" /></button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Senha</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-medium text-foreground">{visiblePasswords.has(entry.id) ? entry.login_password : '••••••••'}</span>
                      <button onClick={() => togglePasswordVisibility(entry.id)} className="text-muted-foreground hover:text-primary transition-colors">
                        {visiblePasswords.has(entry.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      {entry.login_password && <button onClick={() => copyToClipboard(entry.login_password, 'Senha')} className="text-muted-foreground hover:text-primary transition-colors"><Copy className="h-3 w-3" /></button>}
                    </div>
                  </div>
                </div>
                {entry.notes && (
                  <p className="text-[11px] text-muted-foreground mt-3 pt-3 line-clamp-2" style={{ borderTop: '1px solid hsl(220 15% 90% / 0.5)' }}>{entry.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
        </TabsContent>

        <TabsContent value="certificados" className="mt-6">
          <CertificatesPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>

        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">{editingId ? 'Editar Credencial' : 'Nova Credencial'}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-[13px] font-medium">Serviço *</Label><Input value={form.service_name} onChange={e => setForm(f => ({ ...f, service_name: e.target.value }))} placeholder="Ex: Gmail" className="h-10 text-[13px]" /></div>
              <div className="space-y-2"><Label className="text-[13px] font-medium">Tipo</Label>
                <Select value={form.service_type} onValueChange={v => setForm(f => ({ ...f, service_type: v }))}>
                  <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label className="text-[13px] font-medium">E-mail</Label><Input type="email" value={form.login_email} onChange={e => setForm(f => ({ ...f, login_email: e.target.value }))} placeholder="usuario@empresa.com" className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px] font-medium">Usuário</Label><Input value={form.login_username} onChange={e => setForm(f => ({ ...f, login_username: e.target.value }))} placeholder="nome.usuario" className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px] font-medium">Senha</Label><Input type="text" value={form.login_password} onChange={e => setForm(f => ({ ...f, login_password: e.target.value }))} placeholder="••••••••" className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px] font-medium">Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas..." rows={3} className="text-[13px]" /></div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Atualizar' : 'Cadastrar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

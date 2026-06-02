import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { listTemplates, upsertTemplate, deleteTemplate, setTemplateActive, duplicateTemplate } from '@/lib/messages/templates';
import { detectVariables, substituteVariables } from '@/lib/messages/variables';
import { isValidShortcut } from '@/lib/messages/slash';
import type { MessageTemplate, MessageChannel, Visibility } from '@/lib/messages/types';
import { toast } from 'sonner';
import { Plus, Copy, Trash2, Pencil, MessageSquareText, Search } from 'lucide-react';

const CHANNELS: { value: MessageChannel; label: string }[] = [
  { value: 'any', label: 'Qualquer' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'chat', label: 'Chat interno' },
  { value: 'sms', label: 'SMS' },
];

export default function MessageTemplatesPage() {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try { setItems(await listTemplates(tenantId)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [tenantId]);

  const filtered = useMemo(() => items.filter(t => {
    if (filterChannel !== 'all' && t.channel !== filterChannel) return false;
    if (filterStatus === 'active' && !t.active) return false;
    if (filterStatus === 'inactive' && t.active) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) &&
          !t.shortcut.toLowerCase().includes(q) &&
          !t.category.toLowerCase().includes(q) &&
          !t.content.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, search, filterChannel, filterStatus]);

  const startNew = () => {
    setEditing({
      id: '', tenant_id: tenantId!, title: '', shortcut: '/', category: 'geral', content: '',
      channel: 'whatsapp', visibility: 'tenant', active: true, allow_attachments: true,
      send_immediately_allowed: true, requires_review_before_send: false,
      created_by: user?.id || '', created_at: '', updated_at: '',
    });
    setOpen(true);
  };

  const startEdit = (t: MessageTemplate) => { setEditing({ ...t }); setOpen(true); };

  const save = async () => {
    if (!editing || !tenantId || !user) return;
    if (!editing.title.trim()) return toast.error('Informe um título.');
    if (!isValidShortcut(editing.shortcut)) return toast.error('Atalho inválido. Use /palavra (minúsculas, números, _ ou -).');
    try {
      await upsertTemplate({
        ...editing,
        tenant_id: tenantId,
        created_by: editing.created_by || user.id,
      } as any);
      toast.success('Modelo salvo.');
      setOpen(false);
      await load();
    } catch (e: any) {
      const msg = String(e.message || e);
      if (msg.includes('message_templates_unique_shortcut_active')) {
        toast.error('Já existe um modelo ativo com esse atalho neste escritório.');
      } else toast.error(msg);
    }
  };

  const onDuplicate = async (t: MessageTemplate) => {
    if (!user) return;
    try { await duplicateTemplate(t, user.id); toast.success('Modelo duplicado.'); await load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const onDelete = async (t: MessageTemplate) => {
    if (!confirm(`Excluir o modelo "${t.title}"?`)) return;
    try { await deleteTemplate(t.id); await load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const preview = useMemo(() => editing
    ? substituteVariables(editing.content, { contact: { name: 'João' }, user: { name: user?.name || 'Você' }, ticket: { protocol: '1234' } })
    : null, [editing, user]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquareText className="h-6 w-6" /> Mensagens Prontas</h1>
          <p className="text-sm text-muted-foreground">Modelos acionados pelo comando "/" no chat.</p>
        </div>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Novo modelo</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-2 top-3 text-muted-foreground" />
              <Input placeholder="Buscar por título, atalho, categoria…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos canais</SelectItem>
                {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : filtered.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Nenhum modelo cadastrado.</p>
          : (
            <div className="divide-y">
              {filtered.map(t => (
                <div key={t.id} className="py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono text-primary">{t.shortcut}</code>
                      <span className="font-medium">{t.title}</span>
                      <Badge variant="secondary">{t.category}</Badge>
                      <Badge variant="outline">{t.channel}</Badge>
                      {!t.active && <Badge variant="destructive">Inativo</Badge>}
                      {t.visibility === 'private' && <Badge variant="outline">Privado</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{t.content}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setTemplateActive(t.id, !t.active).then(load)}>{t.active ? 'Inativar' : 'Ativar'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => onDuplicate(t)}><Copy className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(t)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Editar modelo' : 'Novo modelo'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Título</Label>
                  <Input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />
                </div>
                <div>
                  <Label>Atalho</Label>
                  <Input value={editing.shortcut} onChange={e => setEditing({ ...editing, shortcut: e.target.value.toLowerCase().replace(/\s+/g,'') })} placeholder="/documentos" />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Input value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} />
                </div>
                <div>
                  <Label>Canal</Label>
                  <Select value={editing.channel} onValueChange={(v) => setEditing({ ...editing, channel: v as MessageChannel })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Visibilidade</Label>
                  <Select value={editing.visibility} onValueChange={(v) => setEditing({ ...editing, visibility: v as Visibility })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant">Todo o escritório</SelectItem>
                      <SelectItem value="private">Apenas eu</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Conteúdo da mensagem</Label>
                <Textarea rows={6} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} placeholder="Olá {nome_contato}, ..." />
                <p className="text-xs text-muted-foreground mt-1">
                  Variáveis: {'{nome_contato}'}, {'{telefone_contato}'}, {'{email_contato}'}, {'{protocolo}'}, {'{ticket_id}'}, {'{nome_atendente}'}, {'{data_atual}'}, {'{hora_atual}'}, {'{assunto_ticket}'}.
                </p>
                {detectVariables(editing.content).length > 0 && (
                  <div className="mt-2 p-2 rounded bg-muted text-xs">
                    <strong>Prévia:</strong> <span className="whitespace-pre-wrap">{preview?.output}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> Ativo</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.allow_attachments} onCheckedChange={(v) => setEditing({ ...editing, allow_attachments: v })} /> Permitir anexos</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.send_immediately_allowed} onCheckedChange={(v) => setEditing({ ...editing, send_immediately_allowed: v })} /> Permitir envio imediato</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.requires_review_before_send} onCheckedChange={(v) => setEditing({ ...editing, requires_review_before_send: v })} /> Exigir revisão antes do envio</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Search, Plus, RefreshCw, Loader2, Trash2, Edit, Phone, MessageSquare, RotateCw, Sparkles, Zap, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Contact {
  id: string;
  phone: string;
  name: string;
  avatar_url: string;
  tags: string[];
  notes: string;
  blocked: boolean;
  opt_in: boolean;
  created_at: string;
}

function initials(s: string) {
  return s.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

function fmtPhone(p: string) {
  const d = (p || '').replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return p;
}

export default function ContactsPanel({ onOpenConversation }: { onOpenConversation?: (contactId: string) => void }) {
  const { tenantId } = useTenant();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Excluir ${selected.size} contato(s) selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from('wa_contacts').delete().in('id', ids);
      if (error) throw new Error(error.message);
      toast.success(`${ids.length} contato(s) removido(s)`);
      setSelected(new Set());
      void load();
    } catch (e: any) {
      toast.error('Erro ao excluir: ' + (e?.message || e));
    } finally {
      setBulkDeleting(false);
    }
  };

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('wa_contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (error) toast.error('Erro ao carregar contatos');
    setContacts((data || []) as Contact[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [tenantId]);

  const filtered = useMemo(() => {
    if (!search) return contacts;
    const t = search.toLowerCase();
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(t) ||
      (c.phone || '').toLowerCase().includes(t)
    );
  }, [contacts, search]);

  const openNew = () => {
    setEditing({ id: '', phone: '', name: '', avatar_url: '', tags: [], notes: '', blocked: false, opt_in: true, created_at: '' });
    setShowDialog(true);
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
    setShowDialog(true);
  };

  const save = async () => {
    if (!editing || !tenantId) return;
    const phone = editing.phone.replace(/\D/g, '');
    if (!phone) { toast.error('Telefone obrigatório'); return; }
    if (editing.id) {
      const { error } = await supabase.from('wa_contacts').update({
        name: editing.name, phone, notes: editing.notes, blocked: editing.blocked, opt_in: editing.opt_in,
      }).eq('id', editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Contato atualizado');
    } else {
      const { error } = await supabase.from('wa_contacts').insert({
        tenant_id: tenantId, name: editing.name, phone, notes: editing.notes,
      });
      if (error) { toast.error(error.message); return; }
      toast.success('Contato criado');
    }
    setShowDialog(false);
    setEditing(null);
    void load();
  };

  const remove = async (c: Contact) => {
    if (!confirm(`Excluir contato ${c.name || c.phone}?`)) return;
    const { error } = await supabase.from('wa_contacts').delete().eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Contato removido');
    void load();
  };

  const startConversation = async (c: Contact) => {
    if (!tenantId) return;
    let { data: existing } = await supabase
      .from('wa_conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contact_id', c.id)
      .neq('status', 'finalizado')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!existing) {
      const { data: created, error } = await supabase
        .from('wa_conversations')
        .insert({ tenant_id: tenantId, contact_id: c.id, status: 'novo' })
        .select('id').maybeSingle();
      if (error) { toast.error(error.message); return; }
      existing = created;
    }
    onOpenConversation?.(c.id);
    toast.success('Conversa aberta');
  };

  const syncFromWhatsApp = async () => {
    if (!tenantId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-evolution', {
        body: { action: 'sync_contacts', tenant_id: tenantId },
      });
      if (error) throw new Error((error as any)?.message || 'Falha na sincronização');
      const res = data as any;
      if (res?.ok === false || res?.error) {
        toast.error(res?.error || 'Não foi possível sincronizar', {
          description: 'Verifique se o WhatsApp está conectado em Configurações.',
        });
        return;
      }
      const ins = res?.inserted ?? 0;
      const upd = res?.updated ?? 0;
      const unique = res?.unique ?? 0;
      const skipReasons = res?.skipReasons || {};
      const lid = skipReasons.lid_without_name || 0;
      if (unique === 0 && ins === 0) {
        toast.warning('Nenhum contato novo encontrado', {
          description:
            'O WhatsApp Web (Multi-Device) não dá acesso à sua agenda do celular — só recebemos contatos que já te mandaram mensagem ou que você salvou no app. Para importar a agenda inteira, salve os contatos como conversas no WhatsApp ou use a importação manual via CSV.',
          duration: 12000,
        });
      } else {
        toast.success(`${ins} novos · ${upd} atualizados`, {
          description: `${unique} contatos únicos sincronizados${lid ? ` · ${lid} contatos com privacidade ignorados (sem número)` : ''}`,
          duration: 8000,
        });
      }
      void load();
    } catch (e: any) {
      toast.error('Erro ao sincronizar: ' + (e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  const cleanupOrphans = async () => {
    if (!tenantId) return;
    if (!confirm('Remover todos os contatos que ainda não trocaram nenhuma mensagem? Isso limpa números importados acidentalmente da agenda.')) return;
    setCleaning(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-evolution', {
        body: { action: 'cleanup_orphans', tenant_id: tenantId },
      });
      if (error) throw new Error((error as any)?.message || 'Falha na limpeza');
      const removed = (data as any)?.removed ?? 0;
      toast.success(removed > 0 ? `${removed} contato(s) sem conversa removidos` : 'Nada para limpar');
      void load();
    } catch (e: any) {
      toast.error('Erro ao limpar: ' + (e?.message || e));
    } finally {
      setCleaning(false);
    }
  };

  const forceReload = async () => {
    if (!tenantId) return;
    setForcing(true);
    const tId = toast.loading('Forçando recarregamento da agenda...', {
      description: 'Pedindo ao WhatsApp para reenviar todos os contatos. Pode levar até 15 segundos.',
    });
    try {
      const { data, error } = await supabase.functions.invoke('wa-evolution', {
        body: { action: 'force_reload_contacts', tenant_id: tenantId, passes: 3, wait_ms: 3000 },
      });
      if (error) throw new Error((error as any)?.message || 'Falha ao forçar recarga');
      const res = data as any;
      if (res?.ok === false) {
        toast.error(res?.error || 'Não foi possível recarregar', { id: tId });
        return;
      }
      const ins = res?.totalInserted ?? 0;
      const upd = res?.totalUpdated ?? 0;
      const last = res?.lastPass || {};
      toast.success(`Recarga concluída: ${ins} novos · ${upd} atualizados`, {
        id: tId,
        description: `${res?.passes || 0} passadas · ${last?.unique || 0} contatos únicos · agenda: ${last?.sources?.agenda || 0} · conversas: ${last?.sources?.chats || 0}`,
        duration: 8000,
      });
      void load();
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e), { id: tId });
    } finally {
      setForcing(false);
    }
  };

  const normalizePhone = (raw: string): string => {
    let d = (raw || '').replace(/\D/g, '');
    if (!d) return '';
    // Remove leading 00 (international prefix)
    if (d.startsWith('00')) d = d.slice(2);
    // BR local numbers (10 or 11 digits) → prepend 55
    if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
    if (d.length < 8 || d.length > 18) return '';
    return d;
  };

  const parseCSV = (text: string): Array<{ name: string; phone: string }> => {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',' || ch === ';' || ch === '\t') { cur.push(field); field = ''; }
        else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
        else if (ch === '\r') { /* skip */ }
        else field += ch;
      }
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    if (!rows.length) return [];

    // Detect header
    const header = rows[0].map(h => h.trim().toLowerCase());
    const nameKeys = ['name', 'nome', 'first name', 'full name', 'display name', 'contato'];
    const phoneKeys = ['phone', 'telefone', 'celular', 'mobile', 'phone 1 - value', 'phone number', 'whatsapp', 'numero', 'número'];
    let nameIdx = header.findIndex(h => nameKeys.some(k => h === k || h.includes(k)));
    let phoneIdx = header.findIndex(h => phoneKeys.some(k => h === k || h.includes(k)));
    const hasHeader = nameIdx !== -1 || phoneIdx !== -1;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    if (!hasHeader) {
      // Guess: first column name, second phone — or single column phone
      if (rows[0].length === 1) { phoneIdx = 0; nameIdx = -1; }
      else { nameIdx = 0; phoneIdx = 1; }
    }

    const out: Array<{ name: string; phone: string }> = [];
    for (const r of dataRows) {
      if (!r || r.every(c => !c.trim())) continue;
      const name = nameIdx >= 0 ? (r[nameIdx] || '').trim() : '';
      const phoneRaw = phoneIdx >= 0 ? (r[phoneIdx] || '').trim() : '';
      const phone = normalizePhone(phoneRaw);
      if (!phone) continue;
      out.push({ name, phone });
    }
    return out;
  };

  const parseVCF = (text: string): Array<{ name: string; phone: string }> => {
    const out: Array<{ name: string; phone: string }> = [];
    const cards = text.split(/BEGIN:VCARD/i).slice(1);
    for (const card of cards) {
      const body = card.split(/END:VCARD/i)[0] || '';
      const lines = body.split(/\r?\n/);
      let name = '';
      const phones: string[] = [];
      for (const line of lines) {
        if (/^FN[:;]/i.test(line)) name = line.replace(/^FN[^:]*:/i, '').trim();
        else if (/^N[:;]/i.test(line) && !name) {
          const parts = line.replace(/^N[^:]*:/i, '').split(';').filter(Boolean);
          name = parts.reverse().join(' ').trim();
        } else if (/^TEL/i.test(line)) {
          const v = line.replace(/^TEL[^:]*:/i, '').trim();
          if (v) phones.push(v);
        }
      }
      for (const p of phones) {
        const phone = normalizePhone(p);
        if (phone) out.push({ name, phone });
      }
    }
    return out;
  };

  const importContacts = async (file: File) => {
    if (!tenantId) return;
    setImporting(true);
    const tId = toast.loading('Importando contatos...', { description: file.name });
    try {
      const text = await file.text();
      const isVcf = /\.vcf$/i.test(file.name) || /BEGIN:VCARD/i.test(text);
      const parsed = isVcf ? parseVCF(text) : parseCSV(text);
      if (!parsed.length) {
        toast.error('Nenhum contato válido encontrado no arquivo', { id: tId });
        return;
      }
      // Dedupe by phone
      const map = new Map<string, { name: string; phone: string }>();
      for (const c of parsed) {
        const ex = map.get(c.phone);
        if (!ex || (!ex.name && c.name)) map.set(c.phone, c);
      }
      const list = Array.from(map.values());

      // Existing phones to differentiate insert vs update
      const { data: existing } = await supabase
        .from('wa_contacts')
        .select('id, phone, name')
        .eq('tenant_id', tenantId)
        .in('phone', list.map(c => c.phone));
      const existingMap = new Map((existing || []).map((e: any) => [e.phone, e]));

      const toInsert = list.filter(c => !existingMap.has(c.phone))
        .map(c => ({ tenant_id: tenantId, phone: c.phone, name: c.name || '' }));
      const toUpdate = list.filter(c => existingMap.has(c.phone) && c.name && existingMap.get(c.phone).name !== c.name);

      let inserted = 0;
      if (toInsert.length) {
        // Chunk inserts
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = await supabase.from('wa_contacts').insert(chunk);
          if (error) throw new Error(error.message);
          inserted += chunk.length;
        }
      }
      let updated = 0;
      for (const c of toUpdate) {
        const ex = existingMap.get(c.phone);
        const { error } = await supabase.from('wa_contacts').update({ name: c.name }).eq('id', ex.id);
        if (!error) updated++;
      }

      toast.success(`${inserted} novos · ${updated} atualizados`, {
        id: tId,
        description: `${list.length} contatos processados do arquivo (${parsed.length - list.length} duplicados ignorados)`,
        duration: 8000,
      });
      void load();
    } catch (e: any) {
      toast.error('Erro ao importar: ' + (e?.message || e), { id: tId });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void importContacts(f); }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contatos por nome ou telefone..." className="pl-9 h-9" />
        </div>
        <Button size="sm" variant="outline" onClick={syncFromWhatsApp} disabled={syncing || forcing} title="Importa contatos da agenda + todas as conversas existentes no WhatsApp">
          {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCw className="h-4 w-4 mr-2" />}
          Sincronizar WhatsApp
        </Button>
        <Button size="sm" variant="outline" onClick={forceReload} disabled={forcing || syncing} title="Faz várias passadas pedindo ao WhatsApp para reenviar TODA a agenda — use quando faltarem contatos">
          {forcing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
          Forçar recarregar agenda
        </Button>
        <Button size="sm" variant="outline" onClick={cleanupOrphans} disabled={cleaning} title="Remove contatos sem nenhuma mensagem">
          {cleaning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Limpar lista
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} title="Importar contatos de um arquivo CSV ou vCard (.vcf) exportado do WhatsApp / Google Contatos">
          {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Importar CSV/vCard
        </Button>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Novo contato
        </Button>
        <Button variant="ghost" size="icon" onClick={load} title="Atualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={filtered.length > 0 && filtered.every(c => selected.has(c.id))}
              onCheckedChange={(v) => {
                if (v) setSelected(new Set(filtered.map(c => c.id)));
                else setSelected(new Set());
              }}
              aria-label="Selecionar todos"
            />
            <p className="text-xs text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selecionado(s) · ${filtered.length} no total` : `${filtered.length} contato(s)`}
            </p>
          </div>
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Excluir selecionados ({selected.size})
            </Button>
          )}
        </div>
        <ScrollArea className="h-[calc(100vh-300px)] min-h-[400px]">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Nenhum contato encontrado
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(c => (
                <div key={c.id} className={cn(
                  'flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors',
                  selected.has(c.id) && 'bg-primary/5'
                )}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleSelected(c.id)}
                    aria-label={`Selecionar ${c.name || c.phone}`}
                  />
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(c.name || c.phone)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{c.name || 'Sem nome'}</p>
                      {c.blocked && <Badge variant="outline" className="text-[9px] h-4 border-destructive/40 text-destructive">Bloqueado</Badge>}
                      {!c.opt_in && <Badge variant="outline" className="text-[9px] h-4">Opt-out</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{fmtPhone(c.phone)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startConversation(c)} title="Abrir conversa">
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="Editar">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)} title="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Editar contato' : 'Novo contato'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Nome do contato" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Telefone (com DDI e DDD)</label>
                <Input
                  value={editing.phone}
                  onChange={e => setEditing({ ...editing, phone: e.target.value })}
                  placeholder="5511999998888"
                  disabled={!!editing.id}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Apenas números. Ex: 5511999998888</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Notas</label>
                <Textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} rows={3} />
              </div>
              {editing.id && (
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editing.opt_in} onChange={e => setEditing({ ...editing, opt_in: e.target.checked })} />
                    Aceita receber mensagens (opt-in)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editing.blocked} onChange={e => setEditing({ ...editing, blocked: e.target.checked })} />
                    Bloqueado
                  </label>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

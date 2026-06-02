import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { listScheduled, cancelScheduled, retryScheduled, createScheduled, updateScheduled, listTemplates } from '@/lib/messages/templates';
import { sendMessage } from '@/lib/messages/channel-adapters';
import { validateAttachment, sanitizeFilename } from '@/lib/messages/attachments';
import { KNOWN_VARIABLES } from '@/lib/messages/variables';
import type { ScheduledMessage, MessageTemplate, ScheduledAttachment } from '@/lib/messages/types';
import { toast } from 'sonner';
import { Calendar, Plus, Send, X, RotateCcw, Search, Users, Paperclip, Mic, Square, Trash2, Info } from 'lucide-react';

interface ContactRow { id: string; name: string | null; phone: string; }

const VAR_DESCRIPTIONS: Record<string, string> = {
  nome_contato: 'Nome do contato selecionado',
  telefone_contato: 'Telefone do contato',
  email_contato: 'E-mail do contato',
  protocolo: 'Protocolo do chamado vinculado',
  ticket_id: 'ID do chamado',
  assunto_ticket: 'Assunto do chamado',
  nome_atendente: 'Nome do atendente que criou',
  data_atual: 'Data do envio (DD/MM/AAAA)',
  hora_atual: 'Hora do envio (HH:MM)',
  link_atendimento: 'Link do atendimento (quando disponível)',
};

function detectKind(mime: string): ScheduledAttachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export default function ScheduledMessagesPage() {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [tab, setTab] = useState<string>('pending');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<ScheduledMessage>>({});
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [useManual, setUseManual] = useState(false);
  const [attachments, setAttachments] = useState<ScheduledAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    if (!tenantId) return;
    try {
      const [s, t] = await Promise.all([listScheduled(tenantId), listTemplates(tenantId)]);
      setItems(s); setTemplates(t);
    } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, [tenantId]);

  const loadContacts = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase
      .from('wa_contacts')
      .select('id, name, phone')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (error) { toast.error('Erro ao carregar contatos'); return; }
    setContacts((data || []) as ContactRow[]);
  };

  const filtered = useMemo(() => items.filter(i => i.status === tab), [items, tab]);
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  const startNew = () => {
    // Default: agora + 1h em horário de Brasília (America/Sao_Paulo)
    const future = new Date(Date.now() + 60 * 60_000);
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(future);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
    const iso = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    setEditing({ channel: 'whatsapp', scheduled_at: iso, content: '', contact_phone: '', contact_name: '' });
    setSelectedContactIds(new Set());
    setContactSearch('');
    setUseManual(false);
    setAttachments([]);
    setOpen(true);
    void loadContacts();
  };

  const toggleContact = (id: string) => {
    setSelectedContactIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAllVisible = () => {
    setSelectedContactIds(prev => {
      const n = new Set(prev);
      const allSelected = filteredContacts.every(c => n.has(c.id));
      if (allSelected) filteredContacts.forEach(c => n.delete(c.id));
      else filteredContacts.forEach(c => n.add(c.id));
      return n;
    });
  };

  const insertVariable = (v: string) => {
    const tag = `{${v}}`;
    const ta = textareaRef.current;
    const current = editing.content || '';
    if (ta) {
      const start = ta.selectionStart ?? current.length;
      const end = ta.selectionEnd ?? current.length;
      const next = current.slice(0, start) + tag + current.slice(end);
      setEditing({ ...editing, content: next });
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + tag.length, start + tag.length);
      });
    } else {
      setEditing({ ...editing, content: current + tag });
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!tenantId || !user) return;
    const channel = (editing.channel || 'whatsapp') as Exclude<ScheduledMessage['channel'], 'any'>;
    setUploading(true);
    try {
      const uploaded: ScheduledAttachment[] = [];
      for (const file of Array.from(files)) {
        const err = validateAttachment({ name: file.name, type: file.type, size: file.size }, channel);
        if (err) { toast.error(err.message); continue; }
        const safe = sanitizeFilename(file.name);
        // RLS exige que o primeiro nível da pasta seja auth.uid()
        const path = `${user.id}/scheduled/${tenantId}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('chat-attachments').upload(path, file, {
          contentType: file.type, upsert: false,
        });
        if (upErr) { toast.error(`Falha ao enviar ${file.name}: ${upErr.message}`); continue; }
        const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path);
        uploaded.push({
          url: pub.publicUrl, name: file.name, mime: file.type,
          kind: detectKind(file.type), size: file.size,
        });
      }
      if (uploaded.length) setAttachments(a => [...a, ...uploaded]);
    } finally { setUploading(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mime });
        const ext = mime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: mime });
        if (!tenantId || !user) return;
        const path = `${user.id}/scheduled/${tenantId}/${crypto.randomUUID()}-${file.name}`;
        const { error } = await supabase.storage.from('chat-attachments').upload(path, file, { contentType: mime });
        if (error) { toast.error('Falha ao salvar áudio: ' + error.message); return; }
        const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path);
        setAttachments(a => [...a, { url: pub.publicUrl, name: file.name, mime, kind: 'ptt', size: file.size }]);
        toast.success('Áudio gravado.');
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e: any) {
      toast.error('Microfone indisponível: ' + (e?.message || e));
    }
  };
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const removeAttachment = (idx: number) => setAttachments(a => a.filter((_, i) => i !== idx));

  const save = async () => {
    if (!tenantId || !user) return;
    const hasContent = !!editing.content?.trim();
    const hasAttachments = attachments.length > 0;
    if (!hasContent && !hasAttachments) return toast.error('Informe o conteúdo ou adicione anexos.');

    const targets: { phone: string; name: string; email: string }[] = [];
    if (useManual) {
      if (!editing.contact_phone?.trim() && editing.channel === 'whatsapp') {
        return toast.error('Telefone obrigatório.');
      }
      targets.push({
        phone: editing.contact_phone || '',
        name: editing.contact_name || '',
        email: editing.contact_email || '',
      });
    } else {
      const selected = contacts.filter(c => selectedContactIds.has(c.id));
      if (selected.length === 0) return toast.error('Selecione ao menos um contato.');
      selected.forEach(c => targets.push({
        phone: c.phone || '',
        name: c.name || '',
        email: '',
      }));
    }

    try {
      // Interpreta o input "YYYY-MM-DDTHH:mm" como horário de Brasília (UTC-3) e converte para UTC.
      const scheduledISO = new Date(`${editing.scheduled_at}:00-03:00`).toISOString();
      await Promise.all(targets.map(t => createScheduled({
        tenant_id: tenantId, created_by: user.id,
        channel: editing.channel as any, content: editing.content || '',
        scheduled_at: scheduledISO,
        contact_phone: t.phone,
        contact_name: t.name,
        contact_email: t.email,
        template_id: editing.template_id || null,
        subject: editing.subject || '',
        attachments,
      } as any)));
      toast.success(targets.length > 1
        ? `${targets.length} mensagens agendadas.`
        : 'Mensagem agendada.');
      setOpen(false); await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const onCancel = async (m: ScheduledMessage) => {
    if (!confirm('Cancelar este agendamento?')) return;
    try { await cancelScheduled(m.id); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const onRetry = async (m: ScheduledMessage) => {
    try { await retryScheduled(m.id); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const onSendNow = async (m: ScheduledMessage) => {
    if (!tenantId) return;
    const r = await sendMessage({
      tenantId, channel: m.channel, contactPhone: m.contact_phone, contactName: m.contact_name,
      content: m.content, templateId: m.template_id, scheduledMessageId: m.id, ticketId: m.ticket_id, sentBy: user?.id,
    });
    if (r.ok) {
      await updateScheduled(m.id, { status: 'sent', sent_at: new Date().toISOString() } as any).catch(() => {});
      toast.success('Mensagem enviada.');
    } else toast.error(r.error || 'Falha no envio');
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Calendar className="h-6 w-6" /> Mensagens Agendadas</h1>
          <p className="text-sm text-muted-foreground">Programe envios para data/hora futura.</p>
        </div>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Novo agendamento</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="sent">Enviadas</TabsTrigger>
          <TabsTrigger value="failed">Falhas</TabsTrigger>
          <TabsTrigger value="canceled">Canceladas</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-3">
          <Card><CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem nesta categoria.</p>
            ) : (
              <div className="divide-y">
                {filtered.map(m => (
                  <div key={m.id} className="p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{m.channel}</Badge>
                        <span className="font-medium">{m.contact_name || m.contact_phone || m.contact_email || '—'}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(m.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                        </span>
                        {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                          <Badge variant="secondary" className="gap-1"><Paperclip className="h-3 w-3" />{m.attachments.length}</Badge>
                        )}
                        {m.error_message && <Badge variant="destructive">{m.error_message.slice(0, 60)}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1 whitespace-pre-wrap">{m.content}</p>
                    </div>
                    <div className="flex gap-1">
                      {m.status === 'pending' && (<>
                        <Button size="sm" variant="ghost" onClick={() => onSendNow(m)}><Send className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => onCancel(m)}><X className="h-4 w-4" /></Button>
                      </>)}
                      {m.status === 'failed' && (
                        <Button size="sm" variant="ghost" onClick={() => onRetry(m)}><RotateCcw className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo agendamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Canal</Label>
                <Select value={editing.channel} onValueChange={(v) => setEditing({ ...editing, channel: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Modelo (opcional)</Label>
                <Select value={editing.template_id || 'none'} onValueChange={(v) => {
                  if (v === 'none') setEditing({ ...editing, template_id: null });
                  else {
                    const t = templates.find(x => x.id === v);
                    setEditing({ ...editing, template_id: v, content: t?.content || editing.content });
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {templates.filter(t => t.active).map(t => <SelectItem key={t.id} value={t.id}>{t.shortcut} — {t.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><Users className="h-4 w-4" /> Destinatários</Label>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant={!useManual ? 'default' : 'outline'} onClick={() => setUseManual(false)}>Contatos salvos</Button>
                  <Button type="button" size="sm" variant={useManual ? 'default' : 'outline'} onClick={() => setUseManual(true)}>Manual</Button>
                </div>
              </div>

              {useManual ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nome do contato</Label>
                    <Input value={editing.contact_name || ''} onChange={e => setEditing({ ...editing, contact_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input value={editing.contact_phone || ''} onChange={e => setEditing({ ...editing, contact_phone: e.target.value })} placeholder="55119..." />
                  </div>
                </div>
              ) : (
                <div className="border rounded-md">
                  <div className="p-2 border-b flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      className="h-8 border-0 focus-visible:ring-0"
                      placeholder="Buscar por nome ou telefone..."
                      value={contactSearch}
                      onChange={e => setContactSearch(e.target.value)}
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={toggleAllVisible}>
                      {filteredContacts.length > 0 && filteredContacts.every(c => selectedContactIds.has(c.id))
                        ? 'Limpar' : 'Selecionar todos'}
                    </Button>
                  </div>
                  <ScrollArea className="h-56">
                    {filteredContacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        {contacts.length === 0 ? 'Nenhum contato salvo.' : 'Nenhum contato encontrado.'}
                      </p>
                    ) : (
                      <div className="divide-y">
                        {filteredContacts.map(c => (
                          <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer">
                            <Checkbox
                              checked={selectedContactIds.has(c.id)}
                              onCheckedChange={() => toggleContact(c.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{c.name || '(sem nome)'}</div>
                              <div className="text-xs text-muted-foreground truncate">{c.phone}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="p-2 border-t text-xs text-muted-foreground">
                    {selectedContactIds.size} contato(s) selecionado(s)
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label>Data e hora de envio</Label>
              <Input type="datetime-local" value={editing.scheduled_at as any} onChange={e => setEditing({ ...editing, scheduled_at: e.target.value })} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Conteúdo</Label>
                <span className="text-xs text-muted-foreground flex items-center gap-1"><Info className="h-3 w-3" /> clique numa variável para inserir</span>
              </div>
              <Textarea ref={textareaRef} rows={5} value={editing.content || ''} onChange={e => setEditing({ ...editing, content: e.target.value })} placeholder="Olá {nome_contato}, ..." />
              <div className="mt-2 flex flex-wrap gap-1">
                {KNOWN_VARIABLES.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    title={VAR_DESCRIPTIONS[v] || v}
                    className="text-xs px-2 py-0.5 rounded border bg-muted hover:bg-accent hover:text-accent-foreground transition"
                  >
                    {`{${v}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Anexos e áudios</Label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.currentTarget.value = ''; }}
                />
                <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4 mr-1" /> {uploading ? 'Enviando...' : 'Adicionar arquivos'}
                </Button>
                {!recording ? (
                  <Button type="button" size="sm" variant="outline" onClick={startRecording}>
                    <Mic className="h-4 w-4 mr-1" /> Gravar áudio
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="destructive" onClick={stopRecording}>
                    <Square className="h-4 w-4 mr-1" /> Parar gravação
                  </Button>
                )}
              </div>
              {attachments.length > 0 && (
                <div className="border rounded-md divide-y">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 text-sm">
                      <Badge variant="outline" className="uppercase text-[10px]">{a.kind}</Badge>
                      <span className="flex-1 truncate">{a.name}</span>
                      {a.kind === 'ptt' || a.kind === 'audio' ? (
                        <audio controls src={a.url} className="h-7" />
                      ) : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeAttachment(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Tamanho máx: 16MB por arquivo. Áudios gravados são enviados como mensagem de voz (PTT) no WhatsApp.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={uploading || recording}>
              {!useManual && selectedContactIds.size > 1 ? `Agendar para ${selectedContactIds.size} contatos` : 'Agendar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

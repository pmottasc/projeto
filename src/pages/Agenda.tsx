import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Clock, MapPin, CalendarDays, Loader2,
} from 'lucide-react';

type AgendaEvent = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  color: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
};

const COLORS = [
  { v: '#3b82f6', n: 'Azul' },
  { v: '#10b981', n: 'Verde' },
  { v: '#f59e0b', n: 'Âmbar' },
  { v: '#ef4444', n: 'Vermelho' },
  { v: '#8b5cf6', n: 'Roxo' },
  { v: '#ec4899', n: 'Rosa' },
];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
function startOfGrid(d: Date) { const s = startOfMonth(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0,0,0,0); return s; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string) { return new Date(v).toISOString(); }

export default function Agenda() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaEvent | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', location: '', color: '#3b82f6',
    all_day: false, start_at: '', end_at: '',
  });
  const [saving, setSaving] = useState(false);

  const monthStart = useMemo(() => startOfMonth(cursor), [cursor]);
  const monthEnd = useMemo(() => endOfMonth(cursor), [cursor]);
  const gridStart = useMemo(() => startOfGrid(cursor), [cursor]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(d.getDate() + i); return d;
  }), [gridStart]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('user_agenda_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_at', new Date(gridStart.getTime() - 86400000).toISOString())
      .lte('start_at', new Date(monthEnd.getTime() + 7 * 86400000).toISOString())
      .order('start_at', { ascending: true });
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    setEvents((data || []) as AgendaEvent[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [user?.id, monthStart.getTime()]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.start_at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    }
    return map;
  }, [events]);

  const openNew = (date?: Date) => {
    const d = date || new Date();
    const start = new Date(d); start.setHours(9, 0, 0, 0);
    const end = new Date(d); end.setHours(10, 0, 0, 0);
    setEditing(null);
    setForm({
      title: '', description: '', location: '', color: '#3b82f6',
      all_day: false,
      start_at: toLocalInput(start.toISOString()),
      end_at: toLocalInput(end.toISOString()),
    });
    setOpen(true);
  };

  const openEdit = (ev: AgendaEvent) => {
    setEditing(ev);
    setForm({
      title: ev.title,
      description: ev.description || '',
      location: ev.location || '',
      color: ev.color || '#3b82f6',
      all_day: ev.all_day,
      start_at: toLocalInput(ev.start_at),
      end_at: toLocalInput(ev.end_at),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) { toast({ title: 'Informe um título', variant: 'destructive' }); return; }
    if (!form.start_at || !form.end_at) { toast({ title: 'Datas obrigatórias', variant: 'destructive' }); return; }
    if (new Date(form.end_at) < new Date(form.start_at)) {
      toast({ title: 'A data final deve ser após a inicial', variant: 'destructive' }); return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      tenant_id: tenantId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      color: form.color,
      all_day: form.all_day,
      start_at: fromLocalInput(form.start_at),
      end_at: fromLocalInput(form.end_at),
    };
    const { error } = editing
      ? await supabase.from('user_agenda_events').update(payload).eq('id', editing.id)
      : await supabase.from('user_agenda_events').insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editing ? 'Evento atualizado' : 'Evento criado' });
    setOpen(false);
    void load();
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirm('Excluir este evento?')) return;
    const { error } = await supabase.from('user_agenda_events').delete().eq('id', editing.id);
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Evento excluído' });
    setOpen(false);
    void load();
  };

  const today = new Date();
  const upcoming = useMemo(() =>
    [...events]
      .filter(e => new Date(e.end_at) >= today)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 6),
    [events] // eslint-disable-line
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" /> Minha Agenda
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Eventos pessoais — somente você tem acesso à sua agenda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setCursor(new Date())}>Hoje</Button>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="px-3 text-sm font-medium min-w-[160px] text-center">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <Button onClick={() => openNew()}>
            <Plus className="h-4 w-4 mr-2" /> Novo evento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <Card className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-px mb-2">
                {WEEKDAYS.map(w => (
                  <div key={w} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center py-2">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                {days.map((d) => {
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const isToday = sameDay(d, today);
                  const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                  const list = eventsByDay.get(k) || [];
                  return (
                    <div
                      key={k}
                      onClick={() => openNew(d)}
                      className={`min-h-[100px] bg-card p-2 cursor-pointer hover:bg-accent/40 transition-colors ${inMonth ? '' : 'opacity-40'}`}
                    >
                      <div className={`text-xs font-medium mb-1 flex items-center justify-center h-6 w-6 rounded-full ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                        {d.getDate()}
                      </div>
                      <div className="space-y-1">
                        {list.slice(0, 3).map(ev => (
                          <button
                            key={ev.id}
                            onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                            className="w-full text-left text-[11px] px-1.5 py-1 rounded truncate font-medium text-white"
                            style={{ backgroundColor: ev.color || '#3b82f6' }}
                            title={ev.title}
                          >
                            {!ev.all_day && new Date(ev.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' '}
                            {ev.title}
                          </button>
                        ))}
                        {list.length > 3 && (
                          <div className="text-[10px] text-muted-foreground px-1">+{list.length - 3} mais</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <Card className="p-4 h-fit">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Próximos eventos
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum evento agendado.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => openEdit(ev)}
                  className="w-full text-left p-2 rounded-md border border-border hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="h-3 w-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: ev.color || '#3b82f6' }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{ev.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(ev.start_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {ev.location && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                          <MapPin className="h-3 w-3" /> {ev.location}
                        </div>
                      )}
                    </div>
                    {ev.all_day && <Badge variant="secondary" className="text-[10px]">Dia todo</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar evento' : 'Novo evento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Título *</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Reunião, consulta, etc." />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="all-day">Dia inteiro</Label>
              <Switch id="all-day" checked={form.all_day} onCheckedChange={v => setForm({ ...form, all_day: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Início</Label>
                <Input type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} />
              </div>
              <div>
                <Label>Fim</Label>
                <Input type="datetime-local" value={form.end_at} onChange={e => setForm({ ...form, end_at: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Local</Label>
              <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Opcional" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div>
              <Label className="mb-2 block">Cor</Label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.v}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.v })}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${form.color === c.v ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c.v }}
                    title={c.n}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editing && (
              <Button variant="destructive" onClick={remove} className="mr-auto">
                <Trash2 className="h-4 w-4 mr-2" /> Excluir
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

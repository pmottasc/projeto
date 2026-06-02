import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  color: string;
  active: boolean;
}

export default function DepartmentsPanel() {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from('departments')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name');
    setItems((data as any) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setName(''); setDescription(''); setColor('#3b82f6'); setActive(true);
    setOpen(true);
  };
  const openEdit = (d: Department) => {
    setEditing(d);
    setName(d.name); setDescription(d.description); setColor(d.color); setActive(d.active);
    setOpen(true);
  };

  const save = async () => {
    if (!tenantId || !name.trim()) { toast.error('Informe o nome do setor'); return; }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from('departments').update({
          name: name.trim(), description, color, active,
        }).eq('id', editing.id);
        if (error) throw error;
        toast.success('Setor atualizado');
      } else {
        const { error } = await supabase.from('departments').insert({
          tenant_id: tenantId, name: name.trim(), description, color, active,
        });
        if (error) throw error;
        toast.success('Setor criado');
      }
      setOpen(false);
      void load();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const remove = async (d: Department) => {
    if (!confirm(`Excluir setor "${d.name}"? Usuários e conversas vinculados ficarão sem setor.`)) return;
    const { error } = await supabase.from('departments').delete().eq('id', d.id);
    if (error) toast.error(error.message);
    else { toast.success('Setor excluído'); void load(); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Setores</h3>
          <p className="text-xs text-muted-foreground">
            Crie filas de atendimento (ex: Suporte, Financeiro, Comercial). O ChatBot pode encaminhar conversas para um setor.
          </p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Novo setor</Button>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum setor cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map(d => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full shrink-0" style={{ backgroundColor: d.color + '33', border: `2px solid ${d.color}` }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name} {!d.active && <span className="text-[10px] text-muted-foreground ml-1">(inativo)</span>}</p>
                    {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(d)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Editar setor' : 'Novo setor'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs">Nome *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Suporte Técnico" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Atendimento de problemas técnicos" />
            </div>
            <div className="flex items-center gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Cor</Label>
                <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-20 p-1" />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Switch checked={active} onCheckedChange={setActive} />
                <Label className="text-xs">Ativo</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

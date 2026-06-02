import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Briefcase, Plus, Pencil, Trash2, ExternalLink, RefreshCw } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

interface WorkLink {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  icon_url: string;
  description: string;
  position: number;
  active: boolean;
}

interface Props {
  tenants: TenantRow[];
}

const FAVICON_SIZE = 128;

const buildFaviconUrl = (rawUrl: string): string => {
  try {
    const u = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${FAVICON_SIZE}`;
  } catch {
    return '';
  }
};

const emptyForm = () => ({
  name: '',
  url: '',
  icon_url: '',
  description: '',
  active: true,
});

export default function WorkLinksPanel({ tenants }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(tenants[0]?.id || '');
  const [links, setLinks] = useState<WorkLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkLink | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenants.length) return;
    if (!selectedTenantId || !tenants.find(t => t.id === selectedTenantId)) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId) return;
    void load();
  }, [selectedTenantId]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('work_links')
      .select('*')
      .eq('tenant_id', selectedTenantId)
      .order('position', { ascending: true });
    if (error) {
      toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    }
    setLinks((data as WorkLink[]) || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (l: WorkLink) => {
    setEditing(l);
    setForm({
      name: l.name,
      url: l.url,
      icon_url: l.icon_url,
      description: l.description,
      active: l.active,
    });
    setDialogOpen(true);
  };

  const handleUrlBlur = () => {
    if (!form.url) return;
    if (form.icon_url && editing && form.icon_url !== buildFaviconUrl(editing.url)) return;
    const fav = buildFaviconUrl(form.url);
    if (fav) setForm(prev => ({ ...prev, icon_url: fav }));
  };

  const refreshIcon = () => {
    const fav = buildFaviconUrl(form.url);
    if (fav) {
      setForm(prev => ({ ...prev, icon_url: fav }));
      toast({ title: 'Ícone atualizado' });
    } else {
      toast({ title: 'URL inválida', variant: 'destructive' });
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast({ title: 'Preencha nome e URL', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      tenant_id: selectedTenantId,
      name: form.name.trim(),
      url: form.url.trim(),
      icon_url: form.icon_url.trim() || buildFaviconUrl(form.url),
      description: form.description.trim(),
      active: form.active,
    };

    if (editing) {
      const { error } = await supabase.from('work_links').update(payload).eq('id', editing.id);
      setSaving(false);
      if (error) {
        toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
        return;
      }
    } else {
      const nextPos = (links[links.length - 1]?.position ?? -1) + 1;
      const { error } = await supabase.from('work_links').insert({
        ...payload,
        position: nextPos,
        created_by: user?.id,
      });
      setSaving(false);
      if (error) {
        toast({ title: 'Erro ao criar', description: error.message, variant: 'destructive' });
        return;
      }
    }
    setDialogOpen(false);
    toast({ title: editing ? 'Atalho atualizado' : 'Atalho criado' });
    void load();
  };

  const remove = async (l: WorkLink) => {
    if (!confirm(`Remover o atalho "${l.name}"?`)) return;
    const { error } = await supabase.from('work_links').delete().eq('id', l.id);
    if (error) {
      toast({ title: 'Erro ao remover', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Removido' });
    void load();
  };

  const toggleActive = async (l: WorkLink, next: boolean) => {
    const { error } = await supabase.from('work_links').update({ active: next }).eq('id', l.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    setLinks(prev => prev.map(x => x.id === l.id ? { ...x, active: next } : x));
  };

  return (
    <Card>
      <div className="p-5 border-b flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Atalhos de Trabalho
          </h2>
          <p className="text-xs text-muted-foreground">
            Gerencie os links rápidos exibidos no menu "Trabalho" da empresa. O ícone é puxado automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-[240px]">
            <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
              <SelectTrigger>
                <SelectValue placeholder="Empresa" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} <span className="text-muted-foreground ml-1">· {t.slug}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={openCreate} disabled={!selectedTenantId}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : links.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Nenhum atalho cadastrado.</p>
      ) : (
        <div className="divide-y">
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
              <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {l.icon_url ? (
                  <img src={l.icon_url} alt={l.name} className="h-full w-full object-contain p-1.5" />
                ) : (
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{l.name}</p>
                <a href={l.url} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-muted-foreground hover:text-primary truncate flex items-center gap-1">
                  {l.url} <ExternalLink className="h-3 w-3" />
                </a>
                {l.description && (
                  <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{l.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={l.active} onCheckedChange={v => toggleActive(l, v)} />
                <Button variant="ghost" size="icon" onClick={() => openEdit(l)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(l)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar atalho' : 'Novo atalho'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Acessorias"
              />
            </div>
            <div>
              <Label>URL *</Label>
              <Input
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
                onBlur={handleUrlBlur}
                placeholder="https://app.exemplo.com.br"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Ao sair do campo, o ícone é puxado automaticamente do site.
              </p>
            </div>
            <div>
              <Label>Ícone (URL)</Label>
              <div className="flex gap-2">
                <Input
                  value={form.icon_url}
                  onChange={e => setForm({ ...form, icon_url: e.target.value })}
                  placeholder="Detectado automaticamente"
                />
                <Button type="button" variant="outline" size="icon" onClick={refreshIcon} title="Buscar ícone novamente">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {form.icon_url && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden">
                    <img src={form.icon_url} alt="Preview" className="h-full w-full object-contain p-1" />
                  </div>
                  Pré-visualização
                </div>
              )}
            </div>
            <div>
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Opcional"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
              <Label className="cursor-pointer">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

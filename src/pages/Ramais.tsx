import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Search, Phone, Edit2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RamalStatus = 'ativo' | 'manutencao' | 'inativo';

const statusLabels: Record<RamalStatus, string> = {
  ativo: 'Ativo',
  manutencao: 'Manutenção',
  inativo: 'Inativo',
};

const statusColors: Record<RamalStatus, string> = {
  ativo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  manutencao: 'bg-amber-50 text-amber-700 border-amber-200',
  inativo: 'bg-red-50 text-red-700 border-red-200',
};

interface RamalRow {
  id: string;
  numero: string;
  colaborador: string;
  status: RamalStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function Ramais() {
  const { user, isAdmin } = useAuth();
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const canManage = isAdmin;

  const [ramais, setRamais] = useState<RamalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RamalRow | null>(null);
  const [numero, setNumero] = useState('');
  const [colaborador, setColaborador] = useState('');
  const [status, setStatus] = useState<RamalStatus>('ativo');
  const [saving, setSaving] = useState(false);

  const fetchRamais = useCallback(async () => {
    const { data } = await supabase
      .from('ramais')
      .select('*')
      .order('numero', { ascending: true });
    setRamais((data as RamalRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRamais(); }, [fetchRamais]);

  const openNew = () => {
    setEditing(null);
    setNumero('');
    setColaborador('');
    setStatus('ativo');
    setDialogOpen(true);
  };

  const openEdit = (r: RamalRow) => {
    setEditing(r);
    setNumero(r.numero);
    setColaborador(r.colaborador);
    setStatus(r.status);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!numero.trim() || numero.trim().length !== 4 || !/^\d{4}$/.test(numero.trim())) {
      toast({ title: 'Erro', description: 'O ramal deve ter exatamente 4 dígitos numéricos.', variant: 'destructive' });
      return;
    }
    if (!colaborador.trim()) {
      toast({ title: 'Erro', description: 'Informe o nome do colaborador.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    if (editing) {
      const { error } = await supabase.from('ramais').update({
        numero: numero.trim(),
        colaborador: colaborador.trim(),
        status,
      }).eq('id', editing.id);
      if (error) toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
      else toast({ title: 'Ramal atualizado com sucesso' });
    } else {
      const { error } = await supabase.from('ramais').insert({
        numero: numero.trim(),
        colaborador: colaborador.trim(),
        status,
        created_by: user!.id,
        tenant_id: requireTenantId(tenantId),
      } as any);
      if (error) toast({ title: 'Erro ao criar', description: error.message, variant: 'destructive' });
      else toast({ title: 'Ramal cadastrado com sucesso' });
    }
    setSaving(false);
    setDialogOpen(false);
    fetchRamais();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este ramal?')) return;
    const { error } = await supabase.from('ramais').delete().eq('id', id);
    if (error) toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Ramal excluído' }); fetchRamais(); }
  };

  const filtered = ramais.filter(r => {
    const matchSearch = !search || r.numero.includes(search) || r.colaborador.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const counts = {
    total: ramais.length,
    ativo: ramais.filter(r => r.status === 'ativo').length,
    manutencao: ramais.filter(r => r.status === 'manutencao').length,
    inativo: ramais.filter(r => r.status === 'inativo').length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: counts.total, color: 'text-foreground' },
          { label: 'Ativos', value: counts.ativo, color: 'text-emerald-600' },
          { label: 'Manutenção', value: counts.manutencao, color: 'text-amber-600' },
          { label: 'Inativos', value: counts.inativo, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="card-premium p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar ramal ou colaborador..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="manutencao">Manutenção</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Ramal
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="card-premium overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ramal</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Colaborador</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                {canManage && <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">Nenhum ramal encontrado</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-primary" />
                      <span className="font-mono font-bold text-foreground">{r.numero}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-foreground">{r.colaborador}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[r.status]}`}>
                      {statusLabels[r.status]}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Ramal' : 'Novo Ramal'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Ramal (4 dígitos)</Label>
              <Input
                value={numero}
                onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setNumero(v); }}
                placeholder="0000"
                maxLength={4}
                className="font-mono text-lg tracking-widest"
              />
            </div>
            <div>
              <Label>Colaborador</Label>
              <Input value={colaborador} onChange={e => setColaborador(e.target.value)} placeholder="Nome do colaborador" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as RamalStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="manutencao">Manutenção</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : editing ? 'Atualizar' : 'Cadastrar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

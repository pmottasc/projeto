import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Search, FileCode2, Plus, Eye, Send, Trash2, Copy, RefreshCw, Building2, Archive } from 'lucide-react';
import { toast } from 'sonner';

interface Empresa {
  id: string;
  razao_social: string;
  cnpj: string;
  codigo_interno?: string | null;
  nfeio_company_id?: string | null;
  ultimo_nsu?: string | null;
  ultima_consulta_at?: string | null;
  cooldown_until?: string | null;
  status: string;
  last_error?: string | null;
  certificado_path?: string | null;
}

interface Documento {
  id: string;
  empresa_id: string;
  chave_acesso: string;
  numero?: string;
  serie?: string;
  cnpj_emitente?: string;
  nome_emitente?: string;
  data_emissao?: string;
  valor_total?: number;
  situacao?: string;
  status_xml: 'resumo' | 'completo' | 'manifestado' | 'erro';
}

const statusColor: Record<string, string> = {
  resumo: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  completo: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  manifestado: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  erro: 'bg-destructive/15 text-destructive border-destructive/30',
};

function fmtCNPJ(c?: string | null) {
  if (!c) return '';
  const d = c.replace(/\D/g, '');
  if (d.length !== 14) return c;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}
function fmtBRL(v?: number | null) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
}
function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR');
}

export default function ConsultaXml() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [filters, setFilters] = useState({ empresa: 'all', from: '', to: '', chave: '', cnpj: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [empresaDialog, setEmpresaDialog] = useState<{ open: boolean; data?: Partial<Empresa> }>({ open: false });
  const [viewerXml, setViewerXml] = useState<{ open: boolean; xml?: string; doc?: Documento }>({ open: false });
  const [manifestar, setManifestar] = useState<{ open: boolean; doc?: Documento }>({ open: false });

  const fetchEmpresas = async () => {
    const r = await invoke('empresa_list', null, 'GET');
    if (r.ok) setEmpresas(r.empresas || []);
  };

  const fetchDocs = async () => {
    if (!tenantId) return;
    setLoading(true);
    let q = supabase.from('xml_documentos').select('*').eq('tenant_id', tenantId).order('data_emissao', { ascending: false }).limit(500);
    if (filters.empresa !== 'all') q = q.eq('empresa_id', filters.empresa);
    if (filters.chave) q = q.ilike('chave_acesso', `%${filters.chave}%`);
    if (filters.cnpj) q = q.ilike('cnpj_emitente', `%${filters.cnpj.replace(/\D/g, '')}%`);
    if (filters.from) q = q.gte('data_emissao', filters.from);
    if (filters.to) q = q.lte('data_emissao', filters.to + 'T23:59:59');
    const { data, error } = await q;
    setLoading(false);
    if (!error) setDocs((data as any) || []);
  };

  useEffect(() => { void fetchEmpresas(); }, [tenantId]);
  useEffect(() => { void fetchDocs(); }, [tenantId, filters]);

  const stats = useMemo(() => {
    const total = docs.length;
    const completos = docs.filter(d => d.status_xml === 'completo' || d.status_xml === 'manifestado').length;
    const resumo = docs.filter(d => d.status_xml === 'resumo').length;
    const erro = docs.filter(d => d.status_xml === 'erro').length;
    const ultimaConsulta = empresas.reduce((acc: string | null, e) => {
      if (!e.ultima_consulta_at) return acc;
      if (!acc || e.ultima_consulta_at > acc) return e.ultima_consulta_at;
      return acc;
    }, null);
    return { total, completos, resumo, erro, ultimaConsulta };
  }, [docs, empresas]);

  async function invoke(action: string, body: any = null, method: 'GET' | 'POST' = 'POST') {
    const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/xml-api?action=${action}`;
    const { data: { session } } = await supabase.auth.getSession();
    const init: RequestInit = {
      method,
      headers: { 'Authorization': `Bearer ${session?.access_token}` },
    };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(url, init);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await r.json();
    return { ok: r.ok, raw: await r.blob() };
  }

  async function handleConsultar() {
    if (filters.empresa === 'all') {
      toast.error('Selecione uma empresa para consultar.');
      return;
    }
    setConsulting(true);
    toast.info('Consulta iniciada com sucesso.');
    const r = await invoke('consultar', { empresa_id: filters.empresa });
    setConsulting(false);
    if (r.blocked) { toast.warning(r.error); return; }
    if (!r.ok) { toast.error(r.error || 'Erro ao consultar SEFAZ.'); return; }
    toast.success(r.mensagem || 'Consulta concluída.');
    await Promise.all([fetchEmpresas(), fetchDocs()]);
  }

  async function handleDownloadSelected(asZip = true) {
    const ids = [...selected];
    if (ids.length === 0) { toast.error('Selecione ao menos um XML.'); return; }
    const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/xml-api?action=download`;
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, zip: asZip }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error || 'Erro no download.');
      return;
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = asZip ? `xmls-${Date.now()}.zip` : `${ids[0]}.xml`;
    a.click();
    toast.success('XML baixado com sucesso.');
  }

  async function handleDownloadOne(doc: Documento) {
    const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/xml-api?action=download`;
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: doc.id, zip: false }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error || 'Erro no download.');
      return;
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.chave_acesso}.xml`;
    a.click();
    toast.success('XML baixado com sucesso.');
  }

  async function handleVisualizar(doc: Documento) {
    const { data } = await supabase.from('xml_documentos').select('xml_completo, xml_resumo').eq('id', doc.id).maybeSingle();
    setViewerXml({ open: true, xml: data?.xml_completo || data?.xml_resumo || '<vazio/>', doc });
  }

  async function handleSaveEmpresa(form: any, pfx?: File | null, senha?: string) {
    const fd = new FormData();
    if (form.id) fd.append('id', form.id);
    fd.append('razao_social', form.razao_social || '');
    fd.append('cnpj', (form.cnpj || '').replace(/\D/g, ''));
    fd.append('codigo_interno', form.codigo_interno || '');
    fd.append('email', form.email || '');
    fd.append('status', form.status || 'ativo');
    if (senha) fd.append('senha', senha);
    if (pfx) fd.append('pfx', pfx);
    const r = await invoke('empresa_save', fd);
    if (r.ok) {
      toast.success('Empresa salva.');
      setEmpresaDialog({ open: false });
      await fetchEmpresas();
    } else toast.error(r.error || 'Erro ao salvar empresa.');
  }

  async function handleDeleteEmpresa(id: string) {
    if (!confirm('Excluir esta empresa e todos os XMLs vinculados?')) return;
    const r = await invoke('empresa_delete', { id });
    if (r.ok) { toast.success('Empresa removida.'); await Promise.all([fetchEmpresas(), fetchDocs()]); }
    else toast.error(r.error || 'Erro ao remover.');
  }

  const empresaSelecionada = empresas.find(e => e.id === filters.empresa);

  return (
    <div className="space-y-6">
      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total de XMLs" value={stats.total} icon={FileCode2} />
        <StatCard label="XMLs completos" value={stats.completos} accent="text-green-600" />
        <StatCard label="Apenas resumo" value={stats.resumo} accent="text-yellow-600" />
        <StatCard label="Com erro" value={stats.erro} accent="text-destructive" />
        <StatCard label="Última consulta" valueText={fmtDateTime(stats.ultimaConsulta)} small />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Empresa</Label>
            <Select value={filters.empresa} onValueChange={v => setFilters(f => ({ ...f, empresa: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {empresas.map(e => <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Chave de acesso</Label>
            <Input value={filters.chave} onChange={e => setFilters(f => ({ ...f, chave: e.target.value }))} placeholder="44 dígitos" />
          </div>
          <div>
            <Label className="text-xs">CNPJ emitente</Label>
            <Input value={filters.cnpj} onChange={e => setFilters(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
          </div>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleConsultar} disabled={consulting || filters.empresa === 'all'}>
          {consulting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
          Consultar XML
        </Button>
        <Button variant="secondary" onClick={() => handleDownloadSelected(true)} disabled={selected.size === 0}>
          <Archive className="h-4 w-4 mr-2" /> Baixar ZIP ({selected.size})
        </Button>
        <Button variant="outline" onClick={() => setEmpresaDialog({ open: true, data: {} })}>
          <Plus className="h-4 w-4 mr-2" /> Cadastrar Empresa
        </Button>
        <Button variant="ghost" onClick={fetchDocs}>
          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
        </Button>
        {empresaSelecionada && (
          <Button variant="ghost" onClick={() => setEmpresaDialog({ open: true, data: empresaSelecionada })}>
            <Building2 className="h-4 w-4 mr-2" /> Editar empresa
          </Button>
        )}
      </div>

      {empresaSelecionada?.cooldown_until && new Date(empresaSelecionada.cooldown_until) > new Date() && (
        <div className="text-xs text-muted-foreground bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
          Próxima consulta liberada em {fmtDateTime(empresaSelecionada.cooldown_until)} (cooldown automático para evitar bloqueio na SEFAZ).
        </div>
      )}

      {/* Tabela */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider">
              <tr>
                <th className="p-3 text-left w-8">
                  <Checkbox
                    checked={selected.size > 0 && selected.size === docs.length}
                    onCheckedChange={(v) => setSelected(v ? new Set(docs.map(d => d.id)) : new Set())}
                  />
                </th>
                <th className="p-3 text-left">Chave / Nº</th>
                <th className="p-3 text-left">Emitente</th>
                <th className="p-3 text-left">Emissão</th>
                <th className="p-3 text-right">Valor</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                </td></tr>
              )}
              {!loading && docs.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                  Nenhum XML encontrado. Selecione uma empresa e clique em "Consultar XML".
                </td></tr>
              )}
              {docs.map(d => (
                <tr key={d.id} className="border-t hover:bg-muted/20">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(d.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(d.id); else next.delete(d.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <div className="font-mono text-[11px] text-muted-foreground">{d.chave_acesso}</div>
                    <div className="text-xs">Nº {d.numero || '—'} · Série {d.serie || '—'}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{d.nome_emitente || '—'}</div>
                    <div className="text-xs text-muted-foreground">{fmtCNPJ(d.cnpj_emitente)}</div>
                  </td>
                  <td className="p-3 text-xs">{d.data_emissao ? new Date(d.data_emissao).toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="p-3 text-right font-medium">{fmtBRL(d.valor_total)}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={statusColor[d.status_xml] || ''}>
                      {d.status_xml}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Visualizar" onClick={() => handleVisualizar(d)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Baixar XML" onClick={() => handleDownloadOne(d)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      {(d.status_xml === 'resumo' || d.status_xml === 'erro') && (
                        <Button size="icon" variant="ghost" title="Manifestar" onClick={() => setManifestar({ open: true, doc: d })}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EmpresaDialog
        open={empresaDialog.open}
        empresa={empresaDialog.data}
        tenantId={tenantId}
        onClose={() => setEmpresaDialog({ open: false })}
        onSave={handleSaveEmpresa}
        onDelete={handleDeleteEmpresa}
      />
      <ViewerDialog
        open={viewerXml.open}
        xml={viewerXml.xml || ''}
        chave={viewerXml.doc?.chave_acesso}
        onClose={() => setViewerXml({ open: false })}
      />
      <ManifestarDialog
        open={manifestar.open}
        doc={manifestar.doc}
        onClose={() => setManifestar({ open: false })}
        onConfirm={async (tipo, just) => {
          const r = await invoke('manifestar', { documento_id: manifestar.doc!.id, tipo, justificativa: just });
          if (r.ok) { toast.success(r.mensagem || 'Manifestação enviada com sucesso.'); setManifestar({ open: false }); await fetchDocs(); }
          else toast.error(r.error || 'Erro na manifestação.');
        }}
      />
    </div>
  );
}

function StatCard({ label, value, valueText, icon: Icon, accent, small }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className={`mt-2 ${small ? 'text-sm' : 'text-2xl'} font-bold ${accent || ''}`}>
          {valueText !== undefined ? valueText : value}
        </p>
      </CardContent>
    </Card>
  );
}

function EmpresaDialog({ open, empresa, tenantId, onClose, onSave, onDelete }: any) {
  const [form, setForm] = useState<any>({});
  const [pfx, setPfx] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [cadastradas, setCadastradas] = useState<any[]>([]);
  const [fetchingCnpj, setFetchingCnpj] = useState(false);

  useEffect(() => { setForm(empresa || {}); setPfx(null); setSenha(''); }, [empresa, open]);

  // Carrega empresas já cadastradas (módulo Tarefas/Empresas) ao abrir em modo cadastro
  useEffect(() => {
    if (!open || empresa?.id || !tenantId) return;
    (async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, cnpj, razao_social, nome_fantasia, email, telefone')
        .eq('tenant_id', tenantId)
        .order('razao_social', { ascending: true });
      setCadastradas(data || []);
    })();
  }, [open, empresa?.id, tenantId]);

  const importarDeCadastrada = (id: string) => {
    const c = cadastradas.find(x => x.id === id);
    if (!c) return;
    setForm((f: any) => ({
      ...f,
      cnpj: (c.cnpj || '').replace(/\D/g, ''),
      razao_social: f.razao_social || c.razao_social || c.nome_fantasia || '',
      email: f.email || c.email || '',
    }));
    toast.success('Dados importados da empresa cadastrada.');
  };

  const buscarPorCnpj = async (raw?: string) => {
    const cnpj = (raw ?? form.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) return;
    // 1) Busca primeiro nas empresas já cadastradas (tarefas)
    const local = cadastradas.find(c => (c.cnpj || '').replace(/\D/g, '') === cnpj);
    if (local) {
      setForm((f: any) => ({
        ...f,
        cnpj,
        razao_social: f.razao_social || local.razao_social || local.nome_fantasia || '',
        email: f.email || local.email || '',
      }));
      toast.success('Empresa encontrada nos cadastros.');
      return;
    }
    // 2) Senão, consulta BrasilAPI
    setFetchingCnpj(true);
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!r.ok) throw new Error('CNPJ não encontrado na Receita.');
      const d = await r.json();
      setForm((f: any) => ({
        ...f,
        cnpj,
        razao_social: f.razao_social || d.razao_social || d.nome_fantasia || '',
        email: f.email || d.email || '',
      }));
      toast.success('Dados do CNPJ preenchidos.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível consultar o CNPJ.');
    } finally {
      setFetchingCnpj(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{form.id ? 'Editar Empresa' : 'Cadastrar Empresa'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!form.id && cadastradas.length > 0 && (
            <div>
              <Label>Importar de empresa já cadastrada</Label>
              <Select value="none" onValueChange={importarDeCadastrada}>
                <SelectTrigger><SelectValue placeholder="Selecione uma empresa cadastrada..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>Selecione...</SelectItem>
                  {cadastradas.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.razao_social || c.nome_fantasia} — {fmtCNPJ(c.cnpj)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Puxa CNPJ, razão social e e-mail do cadastro existente.</p>
            </div>
          )}
          <div>
            <Label>Razão Social</Label>
            <Input value={form.razao_social || ''} onChange={e => setForm({ ...form, razao_social: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>CNPJ</Label>
              <div className="flex gap-1">
                <Input
                  value={form.cnpj || ''}
                  onChange={e => setForm({ ...form, cnpj: e.target.value })}
                  onBlur={e => buscarPorCnpj(e.target.value)}
                  placeholder="00000000000000"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => buscarPorCnpj()} disabled={fetchingCnpj}>
                  {fetchingCnpj ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label>Código interno</Label>
              <Input value={form.codigo_interno || ''} onChange={e => setForm({ ...form, codigo_interno: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>E-mail de contato (opcional)</Label>
            <Input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="contato@empresa.com.br" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status || 'ativo'} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="border-t pt-3 space-y-1">
            <Label>Certificado digital A1 (.pfx ou .p12)</Label>
            <Input type="file" accept=".pfx,.p12" onChange={e => setPfx(e.target.files?.[0] || null)} />
            {form.certificado_path && <p className="text-[11px] text-muted-foreground">Certificado já armazenado.</p>}
          </div>
          <div>
            <Label>Senha do certificado</Label>
            <Input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder={form.id ? "Deixe em branco para manter a atual" : "Senha do .pfx"} />
          </div>
          {!form.nfeio_company_id && (
            <div className="text-xs bg-primary/10 text-primary p-2 rounded">
              Ao salvar com o certificado e a senha, a empresa é cadastrada automaticamente na NFE.io. Você não precisa abrir o painel deles.
            </div>
          )}
          {form.nfeio_company_id && (
            <p className="text-[11px] text-muted-foreground">Empresa registrada na NFE.io (ID: {String(form.nfeio_company_id).slice(0, 8)}…)</p>
          )}
          {form.last_error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{form.last_error}</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {form.id && (
            <Button variant="destructive" onClick={() => onDelete(form.id)}><Trash2 className="h-4 w-4 mr-1" /> Excluir</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(form, pfx, senha || undefined)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewerDialog({ open, xml, chave, onClose }: any) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>XML — {chave}</DialogTitle></DialogHeader>
        <pre className="bg-muted/40 p-3 rounded text-[11px] font-mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all">{xml}</pre>
        <DialogFooter>
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(xml); toast.success('Copiado.'); }}>
            <Copy className="h-4 w-4 mr-2" /> Copiar
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManifestarDialog({ open, doc, onClose, onConfirm }: any) {
  const [tipo, setTipo] = useState('ciencia');
  const [just, setJust] = useState('');
  useEffect(() => { setTipo('ciencia'); setJust(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Manifestar destinatário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground font-mono">{doc?.chave_acesso}</p>
          <div>
            <Label>Tipo de manifestação</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ciencia">Ciência da Operação</SelectItem>
                <SelectItem value="confirmacao">Confirmação da Operação</SelectItem>
                <SelectItem value="desconhecimento">Desconhecimento da Operação</SelectItem>
                <SelectItem value="nao_realizada">Operação não Realizada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(tipo === 'desconhecimento' || tipo === 'nao_realizada') && (
            <div>
              <Label>Justificativa</Label>
              <Input value={just} onChange={e => setJust(e.target.value)} placeholder="Mín. 15 caracteres" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(tipo, just)}>Enviar manifestação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useRef } from 'react';
import { parseCertificate } from '@/lib/certificate-parser';
import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, Download, Trash2, Search, FileBadge, Pencil, Archive, LayoutGrid, List, Grid3x3, Grid2x2 } from 'lucide-react';

interface Certificate {
  id: string;
  name: string;
  owner: string;
  cnpj: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  certificate_password: string;
  expires_at: string | null;
  notes: string;
  created_at: string;
}

const BUCKET = 'digital-certificates';

const formatBytes = (b: number) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
};

const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

export default function CertificatesPanel() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [editing, setEditing] = useState<Certificate | null>(null);
  const [editForm, setEditForm] = useState({ name: '', owner: '', cnpj: '', certificate_password: '', expires_at: '', notes: '' });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [detectOpen, setDetectOpen] = useState(false);
  const [detectPassword, setDetectPassword] = useState('');
  const [detectScope, setDetectScope] = useState<'selected' | 'missing' | 'all'>('missing');
  const [detecting, setDetecting] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'details' | 'large' | 'small'>(() => (localStorage.getItem('cert_view_mode') as any) || 'cards');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem('cert_view_mode', viewMode); }, [viewMode]);

  useEffect(() => { if (tenantId) load(); }, [tenantId]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('digital_certificates').select('*').order('name');
    if (error) toast.error('Erro ao carregar certificados');
    else setItems((data as Certificate[]) || []);
    setLoading(false);
  };

  const handleImport = async (files: FileList | null, defaultPassword = '') => {
    if (!files || files.length === 0 || !tenantId || !user) return;
    setImporting(true);
    const tid = requireTenantId(tenantId);
    let ok = 0, fail = 0, parsedCount = 0;
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() || 'pfx';
      const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
      const path = `${tid}/${crypto.randomUUID()}_${safeBase}.${ext}`;

      // Parse certificate metadata (validity, owner, CNPJ)
      let info = null;
      try { info = await parseCertificate(file, defaultPassword); } catch { info = null; }
      if (info) parsedCount++;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/x-pkcs12',
        upsert: false,
      });
      if (upErr) { fail++; continue; }
      const { error: insErr } = await supabase.from('digital_certificates').insert({
        tenant_id: tid,
        name: info?.subjectCN || safeBase,
        owner: info?.subjectCN || '',
        cnpj: info?.cnpj || '',
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/x-pkcs12',
        certificate_password: (ext === 'pfx' || ext === 'p12') ? defaultPassword : '',
        expires_at: info?.notAfter ? info.notAfter.toISOString().slice(0, 10) : null,
        notes: '',
        created_by: user.id,
      } as any);
      if (insErr) { await supabase.storage.from(BUCKET).remove([path]); fail++; }
      else ok++;
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (ok) toast.success(`${ok} certificado(s) importado(s) — ${parsedCount} com validade detectada`);
    if (fail) toast.error(`${fail} falha(s) na importação`);
    load();
  };

  const downloadOne = async (cert: Certificate) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(cert.file_path);
    if (error || !data) { toast.error('Erro ao baixar'); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = cert.file_name; a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = async (subset?: Certificate[]) => {
    const list = subset && subset.length > 0 ? subset : filtered;
    if (list.length === 0) return;
    setExportingAll(true);
    try {
      const zip = new JSZip();
      for (const cert of list) {
        const { data } = await supabase.storage.from(BUCKET).download(cert.file_path);
        if (data) zip.file(cert.file_name, await data.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `certificados_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${list.length} certificado(s) exportado(s)`);
    } catch {
      toast.error('Erro ao exportar');
    }
    setExportingAll(false);
  };

  const handleDelete = async (cert: Certificate) => {
    if (!confirm(`Excluir o certificado "${cert.name}"?`)) return;
    await supabase.storage.from(BUCKET).remove([cert.file_path]);
    const { error } = await supabase.from('digital_certificates').delete().eq('id', cert.id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Excluído'); setSelected(s => { const n = new Set(s); n.delete(cert.id); return n; }); load(); }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Excluir ${ids.length} certificado(s)?`)) return;
    const paths = items.filter(c => selected.has(c.id)).map(c => c.file_path);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from('digital_certificates').delete().in('id', ids);
    if (error) toast.error('Erro ao excluir em massa');
    else { toast.success(`${ids.length} excluído(s)`); setSelected(new Set()); load(); }
  };

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id)));

  const openEdit = (cert: Certificate) => {
    setEditing(cert);
    setEditForm({
      name: cert.name, owner: cert.owner, cnpj: cert.cnpj,
      certificate_password: cert.certificate_password,
      expires_at: cert.expires_at || '',
      notes: cert.notes,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase.from('digital_certificates').update({
      name: editForm.name, owner: editForm.owner, cnpj: editForm.cnpj,
      certificate_password: editForm.certificate_password,
      expires_at: editForm.expires_at || null,
      notes: editForm.notes,
    }).eq('id', editing.id);
    setSaving(false);
    if (error) toast.error('Erro ao salvar');
    else { toast.success('Atualizado'); setEditing(null); load(); }
  };

  const runDetect = async () => {
    let list: Certificate[] = [];
    if (detectScope === 'selected') list = items.filter(c => selected.has(c.id));
    else if (detectScope === 'missing') list = filtered.filter(c => !c.expires_at);
    else list = filtered;
    if (list.length === 0) { toast.info('Nenhum certificado para processar'); return; }
    setDetecting(true);
    let ok = 0, fail = 0;
    for (const cert of list) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET).download(cert.file_path);
        if (error || !data) { fail++; continue; }
        const pw = detectPassword || cert.certificate_password || '';
        const file = new File([data], cert.file_name, { type: cert.mime_type });
        const info = await parseCertificate(file, pw);
        if (!info) { fail++; continue; }
        const { error: uErr } = await supabase.from('digital_certificates').update({
          expires_at: info.notAfter ? info.notAfter.toISOString().slice(0, 10) : cert.expires_at,
          owner: cert.owner || info.subjectCN || '',
          cnpj: cert.cnpj || info.cnpj || '',
          certificate_password: cert.certificate_password || pw,
        }).eq('id', cert.id);
        if (uErr) fail++; else ok++;
      } catch { fail++; }
    }
    setDetecting(false);
    setDetectOpen(false);
    setDetectPassword('');
    if (ok) toast.success(`${ok} certificado(s) atualizado(s)`);
    if (fail) toast.error(`${fail} não pôde(ram) ser lido(s) — verifique a senha`);
    load();
  };

  const filtered = items.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.owner.toLowerCase().includes(q) || c.cnpj.toLowerCase().includes(q) || c.file_name.toLowerCase().includes(q);
  });

  const isExpiringSoon = (d: string | null) => {
    if (!d) return false;
    const days = (new Date(d).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= 0;
  };
  const isExpired = (d: string | null) => d ? new Date(d).getTime() < Date.now() : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-foreground">Certificados Digitais</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">Importe em massa (.pfx, .p12, .cer, .crt) e baixe quando precisar</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pfx,.p12,.cer,.crt,.pem,.key,application/x-pkcs12"
            className="hidden"
            onChange={e => { setPendingFiles(e.target.files); setImportPassword(''); setImportDialogOpen(true); }}
          />
          <Button variant="outline" className="h-10 text-[13px]" disabled={exportingAll || filtered.length === 0} onClick={() => exportAll()}>
            <Archive className="h-4 w-4 mr-2" /> {exportingAll ? 'Compactando...' : 'Exportar tudo (.zip)'}
          </Button>
          <Button className="h-10 text-[13px]" disabled={importing} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> {importing ? 'Importando...' : 'Importar certificados'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, titular, CNPJ ou arquivo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-10 text-[13px]" />
        </div>
        <div className="flex items-center gap-1 border rounded-md p-0.5 bg-card">
          {([
            { v: 'cards', icon: LayoutGrid, label: 'Cartões' },
            { v: 'large', icon: Grid2x2, label: 'Ícones grandes' },
            { v: 'small', icon: Grid3x3, label: 'Ícones pequenos' },
            { v: 'details', icon: List, label: 'Detalhes' },
          ] as const).map(m => (
            <Button key={m.v} variant={viewMode === m.v ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" title={m.label} onClick={() => setViewMode(m.v)}>
              <m.icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between bg-muted/40 border rounded-md px-3 py-2">
          <label className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer select-none">
            <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleSelectAll} />
            <span className="font-medium">
              {selected.size === 0 ? 'Selecionar todos' : `${selected.size} selecionado(s)`}
            </span>
          </label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => { setDetectScope(selected.size > 0 ? 'selected' : 'missing'); setDetectOpen(true); }}>
              <FileBadge className="h-3.5 w-3.5 mr-1.5" /> Detectar validade
            </Button>
            {selected.size > 0 && (
              <>
                <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={exportingAll} onClick={() => exportAll(items.filter(c => selected.has(c.id)))}>
                  <Archive className="h-3.5 w-3.5 mr-1.5" /> Baixar selecionados (.zip)
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-[12px] text-destructive hover:text-destructive" onClick={handleBulkDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setSelected(new Set())}>Limpar</Button>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        {loading ? (
          <div className="bg-card rounded-xl border p-16 text-center text-[13px] text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-xl border p-16 text-center">
            <FileBadge className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-[14px] text-muted-foreground font-medium">Nenhum certificado cadastrado</p>
            <p className="text-[12px] text-muted-foreground/70 mt-1">Clique em "Importar certificados" para adicionar arquivos em massa</p>
          </div>
        ) : viewMode === 'details' ? (
          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2 w-10"><Checkbox checked={selected.size === filtered.length} onCheckedChange={toggleSelectAll} /></th>
                  <th className="p-2 text-left font-medium">Nome</th>
                  <th className="p-2 text-left font-medium">Titular</th>
                  <th className="p-2 text-left font-medium">CNPJ</th>
                  <th className="p-2 text-left font-medium">Validade</th>
                  <th className="p-2 text-left font-medium">Tamanho</th>
                  <th className="p-2 text-left font-medium">Arquivo</th>
                  <th className="p-2 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(cert => {
                  const expired = isExpired(cert.expires_at);
                  const soon = !expired && isExpiringSoon(cert.expires_at);
                  return (
                    <tr key={cert.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-2"><Checkbox checked={selected.has(cert.id)} onCheckedChange={() => toggleSelect(cert.id)} /></td>
                      <td className="p-2 font-medium text-foreground">
                        <div className="flex items-center gap-2"><FileBadge className="h-3.5 w-3.5 text-primary shrink-0" />{cert.name}</div>
                      </td>
                      <td className="p-2 text-foreground">{cert.owner || '—'}</td>
                      <td className="p-2 text-foreground">{cert.cnpj || '—'}</td>
                      <td className={`p-2 font-medium ${expired ? 'text-destructive' : soon ? 'text-amber-600' : 'text-foreground'}`}>
                        {formatDate(cert.expires_at)}{expired ? ' (vencido)' : soon ? ' (em breve)' : ''}
                      </td>
                      <td className="p-2 text-foreground">{formatBytes(cert.file_size)}</td>
                      <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[200px]" title={cert.file_name}>{cert.file_name}</td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadOne(cert)} title="Baixar"><Download className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cert)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(cert)} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : viewMode === 'large' ? (
          <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {filtered.map(cert => {
              const expired = isExpired(cert.expires_at);
              const isSel = selected.has(cert.id);
              return (
                <div key={cert.id} onClick={() => toggleSelect(cert.id)} onDoubleClick={() => downloadOne(cert)} className={`group relative bg-card rounded-lg border p-3 flex flex-col items-center text-center cursor-pointer transition-all ${isSel ? 'ring-2 ring-primary border-primary' : 'hover:shadow-md'}`}>
                  <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ opacity: isSel ? 1 : undefined }}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggleSelect(cert.id)} onClick={e => e.stopPropagation()} />
                  </div>
                  <FileBadge className={`h-12 w-12 mb-2 ${expired ? 'text-destructive' : 'text-primary'}`} />
                  <p className="text-[12px] font-medium text-foreground truncate w-full" title={cert.name}>{cert.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(cert.expires_at)}</p>
                </div>
              );
            })}
          </div>
        ) : viewMode === 'small' ? (
          <div className="grid gap-2 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {filtered.map(cert => {
              const expired = isExpired(cert.expires_at);
              const isSel = selected.has(cert.id);
              return (
                <div key={cert.id} onClick={() => toggleSelect(cert.id)} onDoubleClick={() => downloadOne(cert)} className={`group bg-card rounded-md border p-2 flex flex-col items-center text-center cursor-pointer transition-all ${isSel ? 'ring-2 ring-primary border-primary' : 'hover:shadow'}`} title={cert.name}>
                  <FileBadge className={`h-6 w-6 mb-1 ${expired ? 'text-destructive' : 'text-primary'}`} />
                  <p className="text-[10px] font-medium text-foreground truncate w-full">{cert.name}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(cert => {
              const expired = isExpired(cert.expires_at);
              const soon = !expired && isExpiringSoon(cert.expires_at);
              const isSel = selected.has(cert.id);
              return (
                <div key={cert.id} className={`bg-card rounded-xl border p-5 hover:shadow-md transition-all ${isSel ? 'ring-2 ring-primary border-primary' : ''}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Checkbox className="mt-1" checked={isSel} onCheckedChange={() => toggleSelect(cert.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileBadge className="h-4 w-4 text-primary shrink-0" />
                          <h3 className="text-[14px] font-semibold text-foreground truncate">{cert.name}</h3>
                        </div>
                        {cert.owner && <p className="text-[12px] text-muted-foreground mt-1 truncate">{cert.owner}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cert)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(cert)} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-[12px]">
                    {cert.cnpj && <div className="flex justify-between"><span className="text-muted-foreground">CNPJ</span><span className="font-medium text-foreground">{cert.cnpj}</span></div>}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Validade</span>
                      <span className={`font-medium ${expired ? 'text-destructive' : soon ? 'text-amber-600' : 'text-foreground'}`}>
                        {formatDate(cert.expires_at)}{expired ? ' (vencido)' : soon ? ' (expira em breve)' : ''}
                      </span>
                    </div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tamanho</span><span className="font-medium text-foreground">{formatBytes(cert.file_size)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Arquivo</span><span className="font-mono text-[11px] text-foreground truncate max-w-[150px]" title={cert.file_name}>{cert.file_name}</span></div>
                  </div>
                  <Button className="w-full mt-4 h-9 text-[12px]" variant="outline" onClick={() => downloadOne(cert)}>
                    <Download className="h-3.5 w-3.5 mr-2" /> Baixar certificado
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Editar Certificado</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label className="text-[13px]">Nome *</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-10 text-[13px]" /></div>
              <div className="space-y-2"><Label className="text-[13px]">Validade</Label><Input type="date" value={editForm.expires_at} onChange={e => setEditForm(f => ({ ...f, expires_at: e.target.value }))} className="h-10 text-[13px]" /></div>
            </div>
            <div className="space-y-2"><Label className="text-[13px]">Titular</Label><Input value={editForm.owner} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} placeholder="Razão social ou nome" className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px]">CNPJ / CPF</Label><Input value={editForm.cnpj} onChange={e => setEditForm(f => ({ ...f, cnpj: e.target.value }))} className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px]">Senha do certificado</Label><Input value={editForm.certificate_password} onChange={e => setEditForm(f => ({ ...f, certificate_password: e.target.value }))} className="h-10 text-[13px]" /></div>
            <div className="space-y-2"><Label className="text-[13px]">Observações</Label><Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="text-[13px]" /></div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? 'Salvando...' : 'Atualizar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={o => { if (!o && !importing) { setImportDialogOpen(false); setPendingFiles(null); if (fileInputRef.current) fileInputRef.current.value = ''; } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Importar certificados</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-[12px] text-muted-foreground">
              {pendingFiles?.length || 0} arquivo(s) selecionado(s). Informe a senha padrão dos certificados .pfx/.p12 para extrair automaticamente a <strong>validade</strong>, <strong>titular</strong> e <strong>CNPJ</strong>. Deixe em branco para importar sem ler os metadados.
            </p>
            <div className="space-y-2">
              <Label className="text-[13px]">Senha padrão (opcional)</Label>
              <Input type="password" value={importPassword} onChange={e => setImportPassword(e.target.value)} placeholder="Senha dos .pfx/.p12" className="h-10 text-[13px]" autoFocus />
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" disabled={importing} onClick={() => { setImportDialogOpen(false); setPendingFiles(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>Cancelar</Button>
            <Button disabled={importing} onClick={async () => {
              const f = pendingFiles; const pw = importPassword;
              setImportDialogOpen(false);
              await handleImport(f, pw);
              setPendingFiles(null);
            }}>{importing ? 'Importando...' : 'Importar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detectOpen} onOpenChange={o => { if (!detecting) setDetectOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Detectar validade</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-[12px] text-muted-foreground">
              Lê os arquivos do storage e atualiza <strong>validade</strong>, <strong>titular</strong> e <strong>CNPJ</strong>. Para .pfx/.p12, informe a senha.
            </p>
            <div className="space-y-2">
              <Label className="text-[13px]">Escopo</Label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { v: 'selected', label: `Selecionados (${selected.size})`, disabled: selected.size === 0 },
                  { v: 'missing', label: `Sem validade (${filtered.filter(c => !c.expires_at).length})`, disabled: false },
                  { v: 'all', label: `Todos visíveis (${filtered.length})`, disabled: false },
                ] as const).map(o => (
                  <Button key={o.v} type="button" size="sm" variant={detectScope === o.v ? 'default' : 'outline'} className="h-8 text-[12px]" disabled={o.disabled} onClick={() => setDetectScope(o.v)}>
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px]">Senha (opcional)</Label>
              <Input type="password" value={detectPassword} onChange={e => setDetectPassword(e.target.value)} placeholder="Senha dos .pfx/.p12" className="h-10 text-[13px]" autoFocus />
              <p className="text-[11px] text-muted-foreground">Se vazio, será usada a senha já salva em cada certificado.</p>
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" disabled={detecting} onClick={() => setDetectOpen(false)}>Cancelar</Button>
            <Button disabled={detecting} onClick={runDetect}>{detecting ? 'Processando...' : 'Detectar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

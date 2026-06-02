import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, ArrowRight, ArrowLeft, Loader2, FileSpreadsheet, Building2,
  Settings2, Filter, Download, Trash2, Plus, CheckCircle2, AlertCircle, Edit3,
  Landmark, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseOFX, parseCSV, parseXLSX, parsePDF, fileHash, type CsvParseOptions,
} from '@/lib/bank-statement/parsers';
import { applyRules } from '@/lib/bank-statement/rules';
import { exportCSV, exportJSON, exportXLSX } from '@/lib/bank-statement/export';
import type { NormalizedTx, RuleRow, FixedRules, MappingConfig } from '@/lib/bank-statement/types';

type Step = 'upload' | 'mapping' | 'fixed' | 'classify' | 'review' | 'export';

const STEPS: { id: Step; label: string; icon: any }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'mapping', label: 'Mapeamento', icon: Settings2 },
  { id: 'fixed', label: 'Regras Fixas', icon: Landmark },
  { id: 'classify', label: 'Classificação', icon: Filter },
  { id: 'review', label: 'Conferência', icon: CheckCircle2 },
  { id: 'export', label: 'Exportação', icon: Download },
];

const MAX_SIZE = 20 * 1024 * 1024;
const NONE = 'none';

interface Company { id: string; name: string; trade_name: string; cnpj: string }
interface BankAccount { id: string; company_id: string; bank_name: string; agency: string; account_number: string }

export default function BankStatement() {
  const { tenantId, isTenantAdmin } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();

  // ---------- nav ----------
  const [view, setView] = useState<'list' | 'wizard'>('list');
  const [step, setStep] = useState<Step>('upload');
  const stepIdx = STEPS.findIndex(s => s.id === step);

  // ---------- master data ----------
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);

  // ---------- wizard state ----------
  const [companyId, setCompanyId] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [fileType, setFileType] = useState<'ofx' | 'csv' | 'xlsx' | 'txt' | 'pdf'>('ofx');
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState('');
  const [mapping, setMapping] = useState<MappingConfig>({
    data: 'Data', descricao: 'Histórico', valor: 'Valor', documento: 'Documento', saldo: 'Saldo',
  });
  const [delimiter, setDelimiter] = useState(';');
  const [startLine, setStartLine] = useState(1);
  const [headerColumns, setHeaderColumns] = useState<string[]>([]);
  const [fixed, setFixed] = useState<FixedRules>({});
  const [transactions, setTransactions] = useState<NormalizedTx[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- review filter ----------
  const [filter, setFilter] = useState<'todos' | 'classificados' | 'pendentes' | 'entradas' | 'saidas'>('todos');
  const [search, setSearch] = useState('');

  // ---------- modals ----------
  const [editTx, setEditTx] = useState<{ idx: number; tx: NormalizedTx } | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const [newAccount, setNewAccount] = useState(false);
  const [ruleDialog, setRuleDialog] = useState<{ tx?: NormalizedTx; rule: Partial<RuleRow> } | null>(null);

  // ---------- load ----------
  const loadAll = useCallback(async () => {
    if (!tenantId) return;
    const [c, a, i, r] = await Promise.all([
      supabase.from('bank_companies' as any).select('*').eq('tenant_id', tenantId).order('name'),
      supabase.from('bank_accounts' as any).select('*').eq('tenant_id', tenantId),
      supabase.from('bank_statement_imports' as any).select('*, bank_companies(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50),
      supabase.from('bank_statement_rules' as any).select('*').eq('tenant_id', tenantId).order('priority'),
    ]);
    setCompanies((c.data as any) || []);
    setAccounts((a.data as any) || []);
    setImports((i.data as any) || []);
    setRules((r.data as any) || []);
  }, [tenantId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ---------- upload step ----------
  const onFileSelected = async (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_SIZE) { toast({ title: 'Arquivo muito grande', description: 'Máx. 20MB', variant: 'destructive' }); return; }
    if (f.size === 0) { toast({ title: 'Arquivo vazio', variant: 'destructive' }); return; }
    setFile(f);
    const ext = f.name.toLowerCase().split('.').pop() || '';
    if (ext === 'ofx') setFileType('ofx');
    else if (ext === 'csv') setFileType('csv');
    else if (ext === 'xlsx' || ext === 'xls') setFileType('xlsx');
    else if (ext === 'txt') setFileType('txt');
    else if (ext === 'pdf') setFileType('pdf');
    const h = await fileHash(f);
    setHash(h);
    // dedup check
    if (companyId) {
      const dup = await supabase.from('bank_statement_imports' as any)
        .select('id').eq('tenant_id', tenantId!).eq('company_id', companyId).eq('file_hash', h).maybeSingle();
      if (dup.data) {
        toast({ title: 'Arquivo já importado', description: 'Esta empresa já recebeu este extrato.', variant: 'destructive' });
      }
    }
    // Pré-leitura para CSV/XLSX: capturar cabeçalho
    if (ext === 'csv' || ext === 'txt') {
      const text = await f.text();
      const firstLines = text.split(/\r?\n/).slice(0, Math.max(1, startLine)).pop() || '';
      const cols = firstLines.split(delimiter).map(c => c.trim()).filter(Boolean);
      setHeaderColumns(cols);
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buf = await f.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      setHeaderColumns((rows[startLine - 1] || []).map(String));
    }
  };

  const handleNextFromUpload = async () => {
    if (!file || !companyId) { toast({ title: 'Selecione empresa e arquivo', variant: 'destructive' }); return; }
    if (fileType === 'ofx') {
      const text = await file.text();
      const r = parseOFX(text);
      setTransactions(r.transactions);
      setStep('fixed');
    } else if (fileType === 'pdf') {
      setLoading(true);
      try {
        const acc = accounts.find(a => a.id === accountId);
        const r = await parsePDF(file, {
          bank: acc?.bank_name, agency: acc?.agency, account: acc?.account_number,
          tenantId: tenantId,
        });
        setTransactions(r.transactions);
        if (!r.transactions.length) {
          toast({ title: 'Nenhum lançamento detectado no PDF', description: 'Tente um PDF de melhor qualidade ou exporte em OFX/CSV.', variant: 'destructive' });
          return;
        }
        toast({ title: 'PDF processado', description: `${r.transactions.length} lançamento(s) extraído(s).` });
        setStep('fixed');
      } catch (e: any) {
        toast({ title: 'Falha ao processar PDF', description: e?.message || String(e), variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    } else {
      setStep('mapping');
    }
  };

  // ---------- parse on mapping/fixed transition ----------
  const runParse = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const ctx: CsvParseOptions = {
        delimiter, startLine, mapping,
        bank: accounts.find(a => a.id === accountId)?.bank_name || '',
        agency: accounts.find(a => a.id === accountId)?.agency || '',
        account: accounts.find(a => a.id === accountId)?.account_number || '',
      };
      let result;
      if (fileType === 'csv' || fileType === 'txt') {
        const text = await file.text();
        result = parseCSV(text, ctx);
      } else if (fileType === 'xlsx') {
        const buf = await file.arrayBuffer();
        result = parseXLSX(buf, ctx);
      } else {
        const text = await file.text();
        result = parseOFX(text);
      }
      setTransactions(result.transactions);
      if (!result.transactions.length) {
        toast({ title: 'Nenhum lançamento detectado', description: 'Ajuste o mapeamento ou linha inicial.', variant: 'destructive' });
        return false;
      }
      return true;
    } finally { setLoading(false); }
  };

  // ---------- classify step ----------
  const runClassify = () => {
    const filteredRules = rules.filter(r =>
      !r.id || true /* all tenant rules */
    );
    const classified = applyRules(transactions, filteredRules, fixed);
    setTransactions(classified);
    setStep('review');
  };

  // ---------- save import + transactions ----------
  const persistImport = async (): Promise<string | null> => {
    if (!tenantId || !user || !file) return null;
    const { data: imp, error } = await supabase.from('bank_statement_imports' as any).insert({
      tenant_id: tenantId, company_id: companyId, bank_account_id: accountId || null,
      user_id: user.id, file_name: file.name, file_type: fileType, file_hash: hash,
      status: 'concluido',
      total_records: transactions.length,
      imported_records: transactions.filter(t => t.status === 'classificado').length,
      pending_records: transactions.filter(t => t.status === 'pendente').length,
      error_records: 0,
      period_start: transactions[0]?.data || null,
      period_end: transactions[transactions.length - 1]?.data || null,
      fixed_rules: fixed,
      finished_at: new Date().toISOString(),
    }).select().single();
    if (error || !imp) { toast({ title: 'Erro ao salvar importação', description: error?.message, variant: 'destructive' }); return null; }
    const rows = transactions.map(t => ({
      tenant_id: tenantId, import_id: (imp as any).id, company_id: companyId,
      transaction_date: t.data, description: t.descricao, document_number: t.documento,
      amount: t.valor, transaction_type: t.tipo, balance: t.saldo,
      category: t.categoria, debit_account: t.contaContabilDebito,
      credit_account: t.contaContabilCredito, accounting_history: t.historicoContabil,
      cost_center: t.centroCusto, status: t.status, raw_data: t.raw || {},
    }));
    // Insert in chunks
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const r = await supabase.from('bank_statement_transactions' as any).insert(chunk);
      if (r.error) { toast({ title: 'Erro ao salvar lançamentos', description: r.error.message, variant: 'destructive' }); }
    }
    setImportId((imp as any).id);
    void loadAll();
    return (imp as any).id;
  };

  // ---------- export ----------
  const handleExport = async (kind: 'xlsx' | 'csv' | 'json') => {
    if (!transactions.some(t => t.status === 'classificado')) {
      toast({ title: 'Nenhum lançamento classificado', variant: 'destructive' }); return;
    }
    let id = importId;
    if (!id) id = await persistImport();
    const company = companies.find(c => c.id === companyId);
    const fname = `extrato_${(company?.trade_name || company?.name || 'empresa').replace(/\s+/g, '_')}_${Date.now()}.${kind}`;
    const ctx = { companyName: company?.name };
    if (kind === 'xlsx') exportXLSX(transactions, fname, ctx);
    else if (kind === 'csv') exportCSV(transactions, fname, ctx);
    else exportJSON(transactions, fname, ctx);
    if (id) {
      await supabase.from('bank_statement_export_logs' as any).insert({
        tenant_id: tenantId, import_id: id, user_id: user!.id,
        export_type: kind, file_name: fname,
        total_records: transactions.filter(t => t.status === 'classificado').length,
      });
    }
  };

  // ---------- filtered view ----------
  const filteredTx = useMemo(() => {
    return transactions
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => {
        if (filter === 'classificados' && t.status !== 'classificado') return false;
        if (filter === 'pendentes' && t.status !== 'pendente') return false;
        if (filter === 'entradas' && t.tipo !== 'entrada') return false;
        if (filter === 'saidas' && t.tipo !== 'saida') return false;
        if (search && !t.descricao.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });
  }, [transactions, filter, search]);

  const totals = useMemo(() => {
    const ent = transactions.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
    const sai = transactions.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
    return { ent, sai, liq: ent - sai, pend: transactions.filter(t => t.status === 'pendente').length };
  }, [transactions]);

  // ---------- guards ----------
  if (!isTenantAdmin) {
    return <div className="p-8"><Card><CardContent className="p-8 text-center text-muted-foreground">Apenas administradores do tenant podem acessar o módulo Extrato Bancário.</CardContent></Card></div>;
  }

  // ---------- LIST view ----------
  if (view === 'list') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Extrato Bancário</h2>
            <p className="text-sm text-muted-foreground">Importe extratos bancários, classifique e exporte para a contabilidade.</p>
          </div>
          <Button onClick={() => { resetWizard(); setView('wizard'); }}>
            <Plus className="h-4 w-4 mr-2" /> Nova Importação
          </Button>
        </div>

        <Tabs defaultValue="imports">
          <TabsList>
            <TabsTrigger value="imports"><History className="h-4 w-4 mr-2" />Importações</TabsTrigger>
            <TabsTrigger value="rules"><Filter className="h-4 w-4 mr-2" />Regras</TabsTrigger>
            <TabsTrigger value="companies"><Building2 className="h-4 w-4 mr-2" />Empresas</TabsTrigger>
          </TabsList>

          <TabsContent value="imports" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {imports.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">Nenhuma importação ainda.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Arquivo</TableHead><TableHead>Empresa</TableHead>
                      <TableHead>Tipo</TableHead><TableHead>Total</TableHead>
                      <TableHead>Pendentes</TableHead><TableHead>Período</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {imports.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.file_name}</TableCell>
                          <TableCell>{i.bank_companies?.name || '—'}</TableCell>
                          <TableCell><Badge variant="outline">{i.file_type}</Badge></TableCell>
                          <TableCell>{i.total_records}</TableCell>
                          <TableCell>{i.pending_records > 0 ? <Badge variant="destructive">{i.pending_records}</Badge> : i.pending_records}</TableCell>
                          <TableCell className="text-xs">{i.period_start} → {i.period_end}</TableCell>
                          <TableCell className="text-xs">{new Date(i.created_at).toLocaleString('pt-BR')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules" className="mt-4">
            <RulesPanel rules={rules} onChange={loadAll} tenantId={tenantId!} userId={user!.id} companies={companies} />
          </TabsContent>

          <TabsContent value="companies" className="mt-4">
            <CompaniesPanel
              companies={companies} accounts={accounts}
              tenantId={tenantId!} userId={user!.id} onChange={loadAll}
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  function resetWizard() {
    setStep('upload'); setFile(null); setHash(''); setTransactions([]);
    setImportId(null); setCompanyId(''); setAccountId('');
    setFixed({}); setMapping({ data: 'Data', descricao: 'Histórico', valor: 'Valor', documento: 'Documento', saldo: 'Saldo' });
  }

  // ---------- WIZARD ----------
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Nova Importação de Extrato</h2>
          <p className="text-sm text-muted-foreground">Etapa {stepIdx + 1} de {STEPS.length}: {STEPS[stepIdx].label}</p>
        </div>
        <Button variant="outline" onClick={() => setView('list')}>Voltar à lista</Button>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex-1 flex items-center gap-2">
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0',
              i < stepIdx ? 'bg-primary text-primary-foreground' :
              i === stepIdx ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
              'bg-muted text-muted-foreground'
            )}><s.icon className="h-4 w-4" /></div>
            <span className={cn('text-xs font-medium', i === stepIdx ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
            {i < STEPS.length - 1 && <div className={cn('flex-1 h-px', i < stepIdx ? 'bg-primary' : 'bg-border')} />}
          </div>
        ))}
      </div>

      {/* STEP UPLOAD */}
      {step === 'upload' && (
        <Card>
          <CardHeader><CardTitle>Upload do Arquivo</CardTitle><CardDescription>Selecione empresa, conta e o arquivo do extrato (.ofx, .pdf, .csv, .xlsx, .xls, .txt). PDFs escaneados são processados via OCR automaticamente.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Empresa</Label>
                <Select value={companyId || NONE} onValueChange={v => setCompanyId(v === NONE ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {companies.length === 0 && <SelectItem value={NONE} disabled>Nenhuma empresa cadastrada</SelectItem>}
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Conta bancária (opcional)</Label>
                <Select value={accountId || NONE} onValueChange={v => setAccountId(v === NONE ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {accounts.filter(a => !companyId || a.company_id === companyId).map(a =>
                      <SelectItem key={a.id} value={a.id}>{a.bank_name} • Ag {a.agency} • CC {a.account_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div
              onDrop={e => { e.preventDefault(); onFileSelected(e.dataTransfer.files?.[0] || null); }}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{file ? file.name : 'Clique ou arraste o arquivo aqui'}</p>
              <p className="text-xs text-muted-foreground mt-1">Formatos: .ofx, .pdf, .csv, .xlsx, .xls, .txt — máx. 20MB</p>
              <input ref={fileInputRef} type="file" hidden accept=".ofx,.pdf,.csv,.xlsx,.xls,.txt"
                onChange={e => onFileSelected(e.target.files?.[0] || null)} />
            </div>

            {file && <div className="text-xs text-muted-foreground">Tipo detectado: <Badge variant="outline">{fileType}</Badge> • Tamanho: {(file.size / 1024).toFixed(1)} KB</div>}

            <div className="flex justify-end">
              <Button onClick={handleNextFromUpload} disabled={!file || !companyId || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {loading && fileType === 'pdf' ? 'Processando PDF…' : 'Avançar'} <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP MAPPING (CSV/XLSX/TXT) */}
      {step === 'mapping' && (
        <Card>
          <CardHeader><CardTitle>Mapeamento de Colunas</CardTitle><CardDescription>Indique qual coluna do arquivo corresponde a cada campo padrão.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {(fileType === 'csv' || fileType === 'txt') && (
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Delimitador</Label>
                  <Select value={delimiter} onValueChange={setDelimiter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value=";">; (ponto e vírgula)</SelectItem>
                      <SelectItem value=",">, (vírgula)</SelectItem>
                      <SelectItem value="\t">Tab</SelectItem>
                      <SelectItem value="|">| (pipe)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Linha do cabeçalho</Label>
                  <Input type="number" min={1} value={startLine} onChange={e => setStartLine(parseInt(e.target.value) || 1)} />
                </div>
              </div>
            )}

            {headerColumns.length > 0 && (
              <div className="rounded-md border p-3 text-xs">
                <p className="font-medium mb-1">Colunas detectadas no arquivo:</p>
                <div className="flex flex-wrap gap-1">{headerColumns.map(c => <Badge key={c} variant="secondary">{c}</Badge>)}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {(['data', 'descricao', 'documento', 'valor', 'entrada', 'saida', 'saldo'] as const).map(k => (
                <div key={k}>
                  <Label className="capitalize">{k === 'descricao' ? 'Descrição' : k}</Label>
                  <Input value={(mapping as any)[k] || ''} onChange={e => setMapping({ ...mapping, [k]: e.target.value })}
                    placeholder={`Nome da coluna no arquivo`} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Use <strong>Valor</strong> com sinal, ou preencha <strong>Entrada/Saída</strong> em colunas separadas.</p>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('upload')}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={async () => { if (await runParse()) setStep('fixed'); }} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Avançar <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP FIXED RULES */}
      {step === 'fixed' && (
        <Card>
          <CardHeader><CardTitle>Regras Fixas</CardTitle><CardDescription>Valores que serão aplicados a todos os lançamentos (podem ser sobrescritos por regras específicas).</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Conta contábil débito padrão</Label><Input value={fixed.defaultDebitAccount || ''} onChange={e => setFixed({ ...fixed, defaultDebitAccount: e.target.value })} /></div>
              <div><Label>Conta contábil crédito padrão</Label><Input value={fixed.defaultCreditAccount || ''} onChange={e => setFixed({ ...fixed, defaultCreditAccount: e.target.value })} /></div>
              <div><Label>Histórico padrão</Label><Input value={fixed.defaultHistory || ''} onChange={e => setFixed({ ...fixed, defaultHistory: e.target.value })} /></div>
              <div><Label>Categoria padrão</Label><Input value={fixed.defaultCategory || ''} onChange={e => setFixed({ ...fixed, defaultCategory: e.target.value })} /></div>
              <div><Label>Centro de custo</Label><Input value={fixed.defaultCostCenter || ''} onChange={e => setFixed({ ...fixed, defaultCostCenter: e.target.value })} /></div>
            </div>
            <div className="text-sm text-muted-foreground">{transactions.length} lançamentos prontos para classificar.</div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(fileType === 'ofx' || fileType === 'pdf' ? 'upload' : 'mapping')}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={() => setStep('classify')}>Avançar <ArrowRight className="h-4 w-4 ml-2" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP CLASSIFY */}
      {step === 'classify' && (
        <Card>
          <CardHeader><CardTitle>Classificação Automática</CardTitle><CardDescription>O sistema vai aplicar {rules.length} regra(s) cadastrada(s) e as regras fixas.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 bg-muted/30 text-sm">
              <p>• {rules.filter(r => r.active).length} regras ativas serão testadas em cada lançamento</p>
              <p>• Lançamentos sem correspondência ficarão como <Badge variant="outline">pendente</Badge></p>
              <p>• Você poderá editar manualmente e criar novas regras na próxima etapa</p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('fixed')}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={runClassify}>Aplicar regras e continuar <ArrowRight className="h-4 w-4 ml-2" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP REVIEW */}
      {step === 'review' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div><CardTitle>Conferência</CardTitle><CardDescription>Revise, edite ou crie regras a partir dos lançamentos pendentes.</CardDescription></div>
              <div className="flex gap-2 text-xs">
                <Badge variant="outline">Entradas: R$ {totals.ent.toFixed(2)}</Badge>
                <Badge variant="outline">Saídas: R$ {totals.sai.toFixed(2)}</Badge>
                <Badge>Líquido: R$ {totals.liq.toFixed(2)}</Badge>
                {totals.pend > 0 && <Badge variant="destructive">{totals.pend} pendentes</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-center">
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="classificados">Classificados</SelectItem>
                  <SelectItem value="pendentes">Pendentes</SelectItem>
                  <SelectItem value="entradas">Entradas</SelectItem>
                  <SelectItem value="saidas">Saídas</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Buscar na descrição..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
              <Button variant="outline" size="sm" onClick={() => setTransactions(applyRules(transactions, rules, fixed))}>
                Reaplicar regras
              </Button>
            </div>

            <div className="rounded-md border max-h-[500px] overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Doc</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Categoria</TableHead><TableHead>Débito</TableHead><TableHead>Crédito</TableHead>
                  <TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredTx.map(({ t, idx }) => (
                    <TableRow key={idx} className={t.status === 'pendente' ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs whitespace-nowrap">{t.data}</TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate" title={t.descricao}>{t.descricao}</TableCell>
                      <TableCell className="text-xs">{t.documento}</TableCell>
                      <TableCell className={cn('text-right text-xs font-mono', t.tipo === 'entrada' ? 'text-green-600' : 'text-destructive')}>
                        {t.tipo === 'entrada' ? '+' : '-'} {t.valor.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs">{t.categoria}</TableCell>
                      <TableCell className="text-xs">{t.contaContabilDebito}</TableCell>
                      <TableCell className="text-xs">{t.contaContabilCredito}</TableCell>
                      <TableCell>
                        {t.status === 'classificado' ? <Badge className="bg-green-600">OK</Badge> :
                         t.status === 'pendente' ? <Badge variant="destructive">Pendente</Badge> :
                         <Badge variant="outline">Erro</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setEditTx({ idx, tx: { ...t } })}><Edit3 className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setRuleDialog({ tx: t, rule: { keyword: t.descricao.split(' ').slice(0, 3).join(' '), match_type: 'contains', transaction_type: t.tipo, category: t.categoria, debit_account: t.contaContabilDebito, credit_account: t.contaContabilCredito, accounting_history: t.historicoContabil, priority: 100, active: true } })}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('classify')}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={() => setStep('export')}>Avançar <ArrowRight className="h-4 w-4 ml-2" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP EXPORT */}
      {step === 'export' && (
        <Card>
          <CardHeader><CardTitle>Exportação</CardTitle><CardDescription>Salve a importação e exporte os lançamentos classificados.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {totals.pend > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                Você tem {totals.pend} lançamento(s) pendente(s) que <strong>não</strong> serão exportados.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Button variant="outline" onClick={() => handleExport('xlsx')}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel (.xlsx)</Button>
              <Button variant="outline" onClick={() => handleExport('csv')}><Download className="h-4 w-4 mr-2" />CSV</Button>
              <Button variant="outline" onClick={() => handleExport('json')}><Download className="h-4 w-4 mr-2" />JSON</Button>
            </div>
            {!importId && <Button onClick={async () => { const id = await persistImport(); if (id) toast({ title: 'Importação salva' }); }}>Salvar importação no banco</Button>}
            {importId && <div className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Importação salva: {importId}</div>}
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep('review')}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={() => { setView('list'); resetWizard(); void loadAll(); }}>Concluir</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Tx dialog */}
      {editTx && (
        <Dialog open onOpenChange={() => setEditTx(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Editar Lançamento</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Descrição</Label><Input value={editTx.tx.descricao} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, descricao: e.target.value } })} /></div>
              <div><Label>Categoria</Label><Input value={editTx.tx.categoria} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, categoria: e.target.value } })} /></div>
              <div><Label>Centro de Custo</Label><Input value={editTx.tx.centroCusto} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, centroCusto: e.target.value } })} /></div>
              <div><Label>Conta débito</Label><Input value={editTx.tx.contaContabilDebito} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, contaContabilDebito: e.target.value } })} /></div>
              <div><Label>Conta crédito</Label><Input value={editTx.tx.contaContabilCredito} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, contaContabilCredito: e.target.value } })} /></div>
              <div className="col-span-2"><Label>Histórico</Label><Input value={editTx.tx.historicoContabil} onChange={e => setEditTx({ ...editTx, tx: { ...editTx.tx, historicoContabil: e.target.value } })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTx(null)}>Cancelar</Button>
              <Button onClick={() => {
                const next = [...transactions];
                const t = { ...editTx.tx };
                t.status = (t.contaContabilDebito && t.contaContabilCredito && t.historicoContabil) ? 'classificado' : 'pendente';
                next[editTx.idx] = t;
                setTransactions(next); setEditTx(null);
              }}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create rule from tx */}
      {ruleDialog && (
        <Dialog open onOpenChange={() => setRuleDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Nova regra a partir do lançamento</DialogTitle></DialogHeader>
            <RuleForm
              value={ruleDialog.rule as RuleRow}
              onChange={(v) => setRuleDialog({ ...ruleDialog, rule: v })}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRuleDialog(null)}>Cancelar</Button>
              <Button onClick={async () => {
                const r = ruleDialog.rule as RuleRow;
                if (!r.keyword) { toast({ title: 'Informe a palavra-chave', variant: 'destructive' }); return; }
                const ins = await supabase.from('bank_statement_rules' as any).insert({
                  tenant_id: tenantId, company_id: companyId || null,
                  keyword: r.keyword, match_type: r.match_type || 'contains',
                  transaction_type: r.transaction_type || 'ambos',
                  category: r.category || '', debit_account: r.debit_account || '',
                  credit_account: r.credit_account || '', accounting_history: r.accounting_history || '',
                  cost_center: r.cost_center || '', priority: r.priority || 100,
                  active: r.active !== false, created_by: user!.id,
                });
                if (ins.error) { toast({ title: 'Erro', description: ins.error.message, variant: 'destructive' }); return; }
                toast({ title: 'Regra criada' });
                setRuleDialog(null);
                await loadAll();
                setTransactions(applyRules(transactions, [...rules, r as RuleRow], fixed));
              }}>Criar regra</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ===== Rule form =====
function RuleForm({ value, onChange }: { value: RuleRow; onChange: (v: RuleRow) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><Label>Palavra-chave</Label><Input value={value.keyword || ''} onChange={e => onChange({ ...value, keyword: e.target.value })} /></div>
      <div><Label>Tipo de match</Label>
        <Select value={value.match_type || 'contains'} onValueChange={(v: any) => onChange({ ...value, match_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="contains">Contém</SelectItem>
            <SelectItem value="starts_with">Começa com</SelectItem>
            <SelectItem value="ends_with">Termina com</SelectItem>
            <SelectItem value="equals">Igual a</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Tipo de movimento</Label>
        <Select value={value.transaction_type || 'ambos'} onValueChange={(v: any) => onChange({ ...value, transaction_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ambos">Ambos</SelectItem>
            <SelectItem value="entrada">Entrada</SelectItem>
            <SelectItem value="saida">Saída</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Categoria</Label><Input value={value.category || ''} onChange={e => onChange({ ...value, category: e.target.value })} /></div>
      <div><Label>Centro de custo</Label><Input value={value.cost_center || ''} onChange={e => onChange({ ...value, cost_center: e.target.value })} /></div>
      <div><Label>Conta débito</Label><Input value={value.debit_account || ''} onChange={e => onChange({ ...value, debit_account: e.target.value })} /></div>
      <div><Label>Conta crédito</Label><Input value={value.credit_account || ''} onChange={e => onChange({ ...value, credit_account: e.target.value })} /></div>
      <div className="col-span-2"><Label>Histórico contábil</Label><Input value={value.accounting_history || ''} onChange={e => onChange({ ...value, accounting_history: e.target.value })} /></div>
      <div><Label>Prioridade</Label><Input type="number" value={value.priority ?? 100} onChange={e => onChange({ ...value, priority: parseInt(e.target.value) || 100 })} /></div>
    </div>
  );
}

// ===== Rules panel =====
function RulesPanel({ rules, tenantId, userId, companies, onChange }: {
  rules: RuleRow[]; tenantId: string; userId: string;
  companies: Company[]; onChange: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Partial<RuleRow> | null>(null);

  const save = async () => {
    if (!editing?.keyword) { toast({ title: 'Informe a palavra-chave', variant: 'destructive' }); return; }
    const payload = {
      keyword: editing.keyword, match_type: editing.match_type || 'contains',
      transaction_type: editing.transaction_type || 'ambos',
      category: editing.category || '', debit_account: editing.debit_account || '',
      credit_account: editing.credit_account || '', accounting_history: editing.accounting_history || '',
      cost_center: editing.cost_center || '', priority: editing.priority ?? 100,
      active: editing.active !== false,
    };
    if (editing.id) {
      await supabase.from('bank_statement_rules' as any).update(payload).eq('id', editing.id);
    } else {
      await supabase.from('bank_statement_rules' as any).insert({ ...payload, tenant_id: tenantId, created_by: userId });
    }
    setEditing(null); await onChange();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Regras de Classificação</CardTitle>
          <Button size="sm" onClick={() => setEditing({ match_type: 'contains', transaction_type: 'ambos', priority: 100, active: true })}>
            <Plus className="h-4 w-4 mr-1" />Nova regra
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma regra cadastrada.</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Palavra-chave</TableHead><TableHead>Tipo</TableHead><TableHead>Movimento</TableHead>
              <TableHead>Débito</TableHead><TableHead>Crédito</TableHead><TableHead>Prio</TableHead>
              <TableHead>Ativa</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-medium">{r.keyword}</TableCell>
                  <TableCell className="text-xs">{r.match_type}</TableCell>
                  <TableCell className="text-xs">{r.transaction_type}</TableCell>
                  <TableCell className="text-xs">{r.debit_account}</TableCell>
                  <TableCell className="text-xs">{r.credit_account}</TableCell>
                  <TableCell className="text-xs">{r.priority}</TableCell>
                  <TableCell>{r.active ? <Badge>Sim</Badge> : <Badge variant="outline">Não</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Edit3 className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={async () => {
                        await supabase.from('bank_statement_rules' as any).delete().eq('id', r.id);
                        await onChange();
                      }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing.id ? 'Editar regra' : 'Nova regra'}</DialogTitle></DialogHeader>
            <RuleForm value={editing as RuleRow} onChange={(v) => setEditing(v)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ===== Companies panel =====
function CompaniesPanel({ companies, accounts, tenantId, userId, onChange }: {
  companies: Company[]; accounts: BankAccount[]; tenantId: string; userId: string; onChange: () => void;
}) {
  const { toast } = useToast();
  const [editC, setEditC] = useState<Partial<Company> | null>(null);
  const [editA, setEditA] = useState<Partial<BankAccount> | null>(null);

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Empresas</CardTitle>
            <Button size="sm" onClick={() => setEditC({})}><Plus className="h-4 w-4 mr-1" />Nova</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {companies.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma empresa cadastrada.</div> :
          <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>CNPJ</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{companies.map(c => (
              <TableRow key={c.id}>
                <TableCell className="text-sm">{c.name}</TableCell>
                <TableCell className="text-xs font-mono">{c.cnpj}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => setEditC(c)}><Edit3 className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Contas Bancárias</CardTitle>
            <Button size="sm" onClick={() => setEditA({})}><Plus className="h-4 w-4 mr-1" />Nova</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {accounts.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma conta cadastrada.</div> :
          <Table><TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Banco</TableHead><TableHead>Conta</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{accounts.map(a => (
              <TableRow key={a.id}>
                <TableCell className="text-xs">{companies.find(c => c.id === a.company_id)?.name || '—'}</TableCell>
                <TableCell className="text-xs">{a.bank_name}</TableCell>
                <TableCell className="text-xs">{a.agency} / {a.account_number}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => setEditA(a)}><Edit3 className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
        </CardContent>
      </Card>

      {editC && (
        <Dialog open onOpenChange={() => setEditC(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editC.id ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Razão Social *</Label><Input value={editC.name || ''} onChange={e => setEditC({ ...editC, name: e.target.value })} /></div>
              <div><Label>Nome Fantasia</Label><Input value={editC.trade_name || ''} onChange={e => setEditC({ ...editC, trade_name: e.target.value })} /></div>
              <div><Label>CNPJ</Label><Input value={editC.cnpj || ''} onChange={e => setEditC({ ...editC, cnpj: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditC(null)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!editC.name) { toast({ title: 'Nome obrigatório', variant: 'destructive' }); return; }
                const payload = { name: editC.name, trade_name: editC.trade_name || '', cnpj: editC.cnpj || '' };
                if (editC.id) await supabase.from('bank_companies' as any).update(payload).eq('id', editC.id);
                else await supabase.from('bank_companies' as any).insert({ ...payload, tenant_id: tenantId, created_by: userId });
                setEditC(null); await onChange();
              }}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {editA && (
        <Dialog open onOpenChange={() => setEditA(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editA.id ? 'Editar Conta' : 'Nova Conta'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Empresa *</Label>
                <Select value={editA.company_id || NONE} onValueChange={v => setEditA({ ...editA, company_id: v === NONE ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Banco *</Label><Input value={editA.bank_name || ''} onChange={e => setEditA({ ...editA, bank_name: e.target.value })} /></div>
                <div><Label>Agência</Label><Input value={editA.agency || ''} onChange={e => setEditA({ ...editA, agency: e.target.value })} /></div>
              </div>
              <div><Label>Conta</Label><Input value={editA.account_number || ''} onChange={e => setEditA({ ...editA, account_number: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditA(null)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!editA.company_id || !editA.bank_name) { toast({ title: 'Empresa e banco obrigatórios', variant: 'destructive' }); return; }
                const payload = {
                  company_id: editA.company_id, bank_name: editA.bank_name,
                  agency: editA.agency || '', account_number: editA.account_number || '',
                };
                if (editA.id) await supabase.from('bank_accounts' as any).update(payload).eq('id', editA.id);
                else await supabase.from('bank_accounts' as any).insert({ ...payload, tenant_id: tenantId, created_by: userId });
                setEditA(null); await onChange();
              }}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

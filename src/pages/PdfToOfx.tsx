/**
 * Página PDF → OFX (conversor local)
 *
 * Pipeline:
 *  1. Upload e validação do arquivo
 *  2. Extração textual (pdf.js) + detecção de banco/conta/agência/período
 *  3. Parsing modular por banco (registry em bank-parsers.ts)
 *  4. Extração e validação de saldos (conciliação)
 *  5. Revisão editável (inline)
 *  6. Validação final do OFX e download
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, FileText, Building2, Eye, Download, ArrowRight, Loader2, AlertCircle,
  CheckCircle2, Trash2, RefreshCw, Plus, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  extractTextFromPDF, detectBank, detectBankAdvanced, extractAccountId, extractPeriod,
  type ExtractedTransaction, type BankDetection,
} from '@/lib/pdf-parser';
import { parseStatementByBank } from '@/lib/bank-parsers';
import { extractUnicredTransactions, isUnicredText } from '@/lib/unicred-parser';
import { extractBalances, reconcile, type ReconciliationResult } from '@/lib/statement-balance';
import { generateOFX, downloadOFX, type OFXBankInfo } from '@/lib/ofx-generator';
import { validateOFX, type OFXValidationResult } from '@/lib/ofx-validator';
import { supabase } from '@/integrations/supabase/client';

// ---------- Constantes ----------

const BANKS = [
  { id: 'bb', name: 'Banco do Brasil', code: '001' },
  { id: 'caixa', name: 'Caixa Econômica Federal', code: '104' },
  { id: 'bradesco', name: 'Bradesco', code: '237' },
  { id: 'itau', name: 'Itaú', code: '341' },
  { id: 'santander', name: 'Santander', code: '033' },
  { id: 'sicoob', name: 'Sicoob', code: '756' },
  { id: 'sicredi', name: 'Sicredi', code: '748' },
  { id: 'unicred', name: 'Unicred', code: '136' },
  { id: 'inter', name: 'Inter', code: '077' },
  { id: 'nubank', name: 'Nubank', code: '260' },
  { id: 'c6', name: 'C6 Bank', code: '336' },
  { id: 'cresol', name: 'Cresol', code: '133' },
  { id: 'outros', name: 'Outros', code: '000' },
];

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

type Step = 'upload' | 'bank' | 'preview' | 'download';

// ---------- Componente Principal ----------

export default function PdfToOfx() {
  const { toast } = useToast();
  const { tenantId } = useTenant();

  // Estado
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [detectedBank, setDetectedBank] = useState<string | null>(null);
  const [detection, setDetection] = useState<BankDetection | null>(null);
  const [accountId, setAccountId] = useState('');
  const [accountType, setAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [transactions, setTransactions] = useState<ExtractedTransaction[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validation, setValidation] = useState<OFXValidationResult | null>(null);
  const [pendingOfx, setPendingOfx] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'upload', label: 'Upload do PDF', icon: <Upload className="h-4 w-4" /> },
    { key: 'bank', label: 'Banco', icon: <Building2 className="h-4 w-4" /> },
    { key: 'preview', label: 'Revisão', icon: <Eye className="h-4 w-4" /> },
    { key: 'download', label: 'Download', icon: <Download className="h-4 w-4" /> },
  ];

  const stepIndex = steps.findIndex(s => s.key === currentStep);

  // ---------- Handlers ----------

  const validateFile = (f: File): string | null => {
    if (!f.name.toLowerCase().endsWith('.pdf')) return 'Apenas arquivos PDF são aceitos.';
    if (f.size > MAX_FILE_SIZE) return 'Arquivo muito grande. Máximo: 15MB.';
    if (f.size === 0) return 'Arquivo vazio.';
    return null;
  };

  const handleFileSelect = useCallback(async (f: File) => {
    const err = validateFile(f);
    if (err) {
      setError(err);
      toast({ title: 'Arquivo inválido', description: err, variant: 'destructive' });
      return;
    }

    setFile(f);
    setError(null);
    setLoading(true);
    setProgress(10);

    try {
      // 1. Tentativa de extração local (PDF com camada de texto)
      setProgress(25);
      const pages = await extractTextFromPDF(f);
      let fullText = pages.join('\n');
      let usedOcr = false;

      // Qualidade: >= 200 chars e >= 50 letras. Senão, cai no OCR.
      const letters = (fullText.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
      const poor = fullText.trim().length < 200 || letters < 50;

      if (poor) {
        setProgress(45);
        toast({
          title: 'PDF escaneado detectado',
          description: 'Usando OCR via IA para ler o extrato. Isso pode levar alguns segundos...',
        });

        // Converte arquivo para base64 para mandar ao OCR
        const arrayBuffer = await f.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        const fileBase64 = btoa(binary);

        const { data, error: fnError } = await supabase.functions.invoke('ocr-pdf-statement', {
          body: { fileBase64, fileName: f.name, tenant_id: tenantId },
        });

        if (fnError) throw new Error(fnError.message || 'Falha no OCR do PDF.');
        if (!data) throw new Error('OCR não retornou dados.');
        if (data?.quota_exceeded) throw new Error(data.error || 'Limite mensal atingido. Faça upgrade do plano.');
        if (data.error) throw new Error(data.error);

        const ocrText = String(data.text || '').trim();
        if (!ocrText || ocrText.length < 40) {
          throw new Error('OCR não conseguiu ler conteúdo útil do PDF.');
        }

        fullText = ocrText;
        usedOcr = true;
      }

      setRawText(fullText);

      // 2. Detecção automática de banco (camadas: nome → COMPE → CNPJ → heurística)
      const det = await detectBankAdvanced(fullText);
      setDetection(det);
      const bankKey = det.bankId;
      if (bankKey && BANKS.find(b => b.id === bankKey)) {
        setDetectedBank(bankKey);
        setSelectedBank(bankKey);
      } else {
        setDetectedBank(null);
        // Se BrasilAPI achou um banco mas não temos parser dedicado, deixa "outros" pré-selecionado
        if (det.compeCode) setSelectedBank('outros');
      }

      const acct = extractAccountId(fullText);
      if (acct) setAccountId(acct.replace(/[^\d]/g, ''));

      setProgress(75);

      // 3. Parsing de transações (usa banco detectado ou smart como fallback)
      const parserBank = bankKey || 'outros';
      const period = extractPeriod(fullText);
      const refYear = period.start ? parseInt(period.start.slice(0, 4), 10) : new Date().getFullYear();

      let parsed: ExtractedTransaction[] = [];

      // Unicred: parser dedicado (classifica por palavras-chave do histórico)
      if (parserBank === 'unicred' || isUnicredText(fullText)) {
        const unicred = await extractUnicredTransactions(f, fullText);
        parsed = unicred.transactions;
      }

      if (parsed.length === 0) {
        parsed = parseStatementByBank(fullText, parserBank, { referenceYear: refYear });
      }

      if (parsed.length === 0) {
        throw new Error(
          'Nenhuma transação foi identificada. Tente selecionar o banco manualmente na próxima etapa e clicar em "Reprocessar".'
        );
      }

      setTransactions(parsed);

      // 4. Conciliação de saldos
      const balances = extractBalances(fullText);
      setReconciliation(reconcile(parsed, balances));

      setProgress(100);
      setCurrentStep('bank');

      const bankLabel = det.bankName
        || (bankKey ? BANKS.find(b => b.id === bankKey)?.name : null);
      const details = [
        `${parsed.length} transação(ões)`,
        bankLabel ? `Banco: ${bankLabel}${det.compeCode ? ` (${det.compeCode})` : ''}` : null,
        acct ? `Conta: ${acct}` : null,
        usedOcr ? 'via OCR' : null,
      ].filter(Boolean).join(' • ');

      toast({ title: 'Extrato processado', description: details });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao processar o PDF.';
      setError(msg);
      toast({ title: 'Erro no processamento', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reprocessa com o banco selecionado manualmente (caso o detectado esteja errado)
  const handleReparse = useCallback(async () => {
    if (!rawText || !selectedBank) return;
    const period = extractPeriod(rawText);
    const refYear = period.start ? parseInt(period.start.slice(0, 4), 10) : new Date().getFullYear();

    let parsed: ExtractedTransaction[] = [];
    if (selectedBank === 'unicred' && file) {
      const unicred = await extractUnicredTransactions(file);
      parsed = unicred.transactions;
    }
    if (parsed.length === 0) {
      parsed = parseStatementByBank(rawText, selectedBank, { referenceYear: refYear });
    }

    if (parsed.length === 0) {
      toast({
        title: 'Nenhuma transação encontrada',
        description: 'Tente outro banco ou revise o PDF.',
        variant: 'destructive',
      });
      return;
    }
    setTransactions(parsed);
    const balances = extractBalances(rawText);
    setReconciliation(reconcile(parsed, balances));
    toast({ title: 'Reprocessado', description: `${parsed.length} lançamento(s) identificado(s).` });
  }, [rawText, selectedBank, file, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const handleProceedToReview = useCallback(() => {
    if (!selectedBank || transactions.length === 0) return;
    setCurrentStep('preview');
  }, [selectedBank, transactions.length]);

  const handleGenerateOFX = useCallback(() => {
    const bankCode = BANKS.find(b => b.id === selectedBank)?.code || '000';
    const bankInfo: OFXBankInfo = {
      bankId: bankCode,
      accountId: accountId || '000000',
      accountType,
    };
    const ofxContent = generateOFX(transactions, bankInfo, selectedBank);
    const result = validateOFX(ofxContent, transactions, bankInfo);
    setValidation(result);
    setPendingOfx(ofxContent);

    if (!result.ok) {
      toast({
        title: 'Validação do OFX falhou',
        description: `${result.errors.length} erro(s) encontrado(s). Corrija antes de baixar.`,
        variant: 'destructive',
      });
      return;
    }

    downloadOFX(ofxContent);
    setCurrentStep('download');
    toast({
      title: 'OFX validado e gerado',
      description: result.warnings.length > 0
        ? `Download iniciado com ${result.warnings.length} aviso(s).`
        : 'Download iniciado.',
    });
  }, [transactions, selectedBank, accountId, accountType, toast]);

  const handleForceDownload = useCallback(() => {
    if (!pendingOfx) return;
    downloadOFX(pendingOfx);
    setCurrentStep('download');
    toast({ title: 'OFX baixado', description: 'Download forçado apesar dos avisos.' });
  }, [pendingOfx, toast]);

  const handleReset = () => {
    setFile(null);
    setRawText('');
    setSelectedBank('');
    setDetectedBank(null);
    setAccountId('');
    setTransactions([]);
    setReconciliation(null);
    setError(null);
    setValidation(null);
    setPendingOfx(null);
    setCurrentStep('upload');
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---------- Edição inline ----------

  const updateTransaction = (i: number, patch: Partial<ExtractedTransaction>) => {
    setTransactions(prev => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const removeTransaction = (i: number) => {
    setTransactions(prev => prev.filter((_, idx) => idx !== i));
  };

  const addTransaction = () => {
    const today = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    setTransactions(prev => [
      ...prev,
      { date: yyyymmdd, description: 'Nova transação', document: '', amount: 0, type: 'DEBIT' as const },
    ]);
  };

  // ---------- Helpers de display ----------

  const formatDateInput = (ofxDate: string) => {
    if (ofxDate.length < 8) return '';
    return `${ofxDate.slice(0, 4)}-${ofxDate.slice(4, 6)}-${ofxDate.slice(6, 8)}`;
  };

  const parseDateInput = (htmlDate: string): string => htmlDate.replace(/-/g, '');

  const totals = useMemo(() => {
    const totalCredits = transactions.filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.amount, 0);
    const totalDebits = transactions.filter(t => t.type === 'DEBIT').reduce((s, t) => s + t.amount, 0);
    return { totalCredits, totalDebits };
  }, [transactions]);

  const hasInvalidLines = transactions.some(t => !t.date || t.amount <= 0 || !t.description);
  const exportBlocked = transactions.length === 0 || hasInvalidLines;

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => { if (i <= stepIndex) setCurrentStep(step.key); }}
                  disabled={i > stepIndex}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                    i === stepIndex
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : i < stepIndex
                        ? 'bg-accent text-accent-foreground cursor-pointer hover:bg-accent/80'
                        : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : step.icon}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
                {i < steps.length - 1 && (
                  <div className={cn('flex-1 h-px mx-2', i < stepIndex ? 'bg-primary/40' : 'bg-border')} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Processando...</span>
            </div>
            <Progress value={progress} className="mt-3 h-2" />
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && !loading && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Upload */}
      {currentStep === 'upload' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Upload className="h-5 w-5 text-primary" />
              Upload do Extrato PDF
            </CardTitle>
            <CardDescription>
              Arraste ou selecione um PDF editável de extrato bancário (não imagem escaneada)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all',
                dragOver
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-border hover:border-primary/50 hover:bg-accent/30'
              )}
            >
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">
                Arraste o PDF aqui ou clique para selecionar
              </p>
              <p className="text-xs text-muted-foreground">
                PDF editável • Máximo 15MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Banco */}
      {currentStep === 'bank' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" />
              Configuração do Banco
            </CardTitle>
            <CardDescription>
              {detectedBank
                ? `Banco detectado automaticamente: ${BANKS.find(b => b.id === detectedBank)?.name}`
                : 'Não foi possível detectar o banco. Selecione manualmente.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detection && (
              <div
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border text-sm',
                  detection.confidence === 'high' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  detection.confidence === 'medium' && 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                  detection.confidence === 'low' && 'border-destructive/40 bg-destructive/10 text-destructive',
                )}
              >
                {detection.confidence === 'high' ? (
                  <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                ) : detection.confidence === 'medium' ? (
                  <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {detection.confidence === 'high' && 'Banco identificado com alta confiança'}
                    {detection.confidence === 'medium' && 'Banco provável — confirme abaixo'}
                    {detection.confidence === 'low' && 'Não foi possível identificar o banco — selecione manualmente'}
                  </div>
                  {(detection.bankName || detection.compeCode) && (
                    <div className="text-xs opacity-90 mt-0.5">
                      {detection.bankName ?? '—'}
                      {detection.compeCode && ` • Código FEBRABAN ${detection.compeCode}`}
                      {detection.matchedBy && ` • via ${detection.matchedBy === 'name' ? 'nome no PDF' : detection.matchedBy === 'compe' ? 'código COMPE' : detection.matchedBy === 'cnpj' ? 'CNPJ' : 'heurística'}`}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Banco</Label>
                <Select
                  value={selectedBank}
                  onValueChange={(v) => { setSelectedBank(v); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o banco" />
                  </SelectTrigger>
                  <SelectContent>
                    {BANKS.map(bank => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bank.code} - {bank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Conta</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="Número da conta"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de conta</Label>
                <Select value={accountType} onValueChange={v => setAccountType(v as 'CHECKING' | 'SAVINGS')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECKING">Conta Corrente</SelectItem>
                    <SelectItem value="SAVINGS">Poupança</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {file && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 text-sm">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-foreground font-medium truncate">{file.name}</span>
                <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" onClick={handleReset}>
                <Trash2 className="h-4 w-4 mr-2" />
                Recomeçar
              </Button>
              <Button variant="outline" onClick={handleReparse} disabled={!selectedBank || !rawText}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reprocessar com este banco
              </Button>
              <Button onClick={handleProceedToReview} disabled={!selectedBank || transactions.length === 0}>
                Revisar Transações
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Revisão */}
      {currentStep === 'preview' && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Eye className="h-5 w-5 text-primary" />
              Revisão das Transações
            </CardTitle>
            <CardDescription>
              {transactions.length} lançamento(s). Edite os campos diretamente na tabela antes de gerar o OFX.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-accent/50">
                <p className="text-xs text-muted-foreground">Lançamentos</p>
                <p className="text-lg font-bold text-foreground">{transactions.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10">
                <p className="text-xs text-muted-foreground">Créditos</p>
                <p className="text-lg font-bold text-green-600">
                  R$ {totals.totalCredits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-red-500/10">
                <p className="text-xs text-muted-foreground">Débitos</p>
                <p className="text-lg font-bold text-red-600">
                  R$ {totals.totalDebits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-accent/50">
                <p className="text-xs text-muted-foreground">Saldo movimentado</p>
                <p className={cn('text-lg font-bold', (totals.totalCredits - totals.totalDebits) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  R$ {(totals.totalCredits - totals.totalDebits).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Conciliação de saldos */}
            {reconciliation && (
              <div className={cn(
                'p-4 rounded-lg border flex items-start gap-3',
                reconciliation.ok
                  ? 'border-primary/20 bg-primary/5'
                  : 'border-destructive/40 bg-destructive/5'
              )}>
                {reconciliation.ok
                  ? <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  : <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                }
                <div className="flex-1 text-sm space-y-1">
                  <p className="font-medium text-foreground">
                    {reconciliation.ok ? 'Conciliação' : 'Inconsistência de saldo'}
                  </p>
                  <p className="text-muted-foreground">{reconciliation.message}</p>
                </div>
              </div>
            )}

            {/* Tabela editável */}
            <div className="max-h-[480px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[140px]">Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-[110px]">Documento</TableHead>
                    <TableHead className="w-[140px] text-right">Valor (R$)</TableHead>
                    <TableHead className="w-[110px]">Tipo</TableHead>
                    <TableHead className="w-[50px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t, i) => {
                    const invalid = !t.date || t.amount <= 0 || !t.description;
                    return (
                      <TableRow key={i} className={invalid ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          <Input
                            type="date"
                            value={formatDateInput(t.date)}
                            onChange={e => updateTransaction(i, { date: parseDateInput(e.target.value) })}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={t.description}
                            onChange={e => updateTransaction(i, { description: e.target.value })}
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={t.document}
                            onChange={e => updateTransaction(i, { document: e.target.value })}
                            className="h-8 text-xs font-mono"
                            placeholder="-"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={t.amount}
                            onChange={e => updateTransaction(i, { amount: parseFloat(e.target.value) || 0 })}
                            className="h-8 text-xs font-mono text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={t.type}
                            onValueChange={v => updateTransaction(i, { type: v as 'CREDIT' | 'DEBIT' })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CREDIT">
                                <Badge variant="default" className="text-[10px]">Crédito</Badge>
                              </SelectItem>
                              <SelectItem value="DEBIT">
                                <Badge variant="destructive" className="text-[10px]">Débito</Badge>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeTransaction(i)}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <Button variant="outline" size="sm" onClick={addTransaction}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar lançamento manualmente
            </Button>

            {hasInvalidLines && (
              <p className="text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-3 w-3" />
                Existem lançamentos com data, valor ou descrição inválidos. Corrija antes de exportar.
              </p>
            )}

            {/* Painel de validação do OFX */}
            {validation && (
              <div
                className={cn(
                  'rounded-lg border p-4 space-y-2',
                  validation.ok
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-destructive/40 bg-destructive/5'
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {validation.ok ? (
                    <>
                      <ShieldCheck className="h-4 w-4 text-green-600" />
                      <span className="text-foreground">OFX validado com sucesso</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">
                        {validation.errors.length} erro(s) na validação do OFX
                      </span>
                    </>
                  )}
                </div>

                <div className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
                  <span>Lançamentos: <strong className="text-foreground">{validation.summary.count}</strong></span>
                  <span>Créditos: <strong className="text-foreground">R$ {validation.summary.totalCredits.toFixed(2)}</strong></span>
                  <span>Débitos: <strong className="text-foreground">R$ {validation.summary.totalDebits.toFixed(2)}</strong></span>
                  <span>Saldo (LEDGERBAL): <strong className="text-foreground">R$ {validation.summary.ledgerBalance.toFixed(2)}</strong></span>
                </div>

                {validation.errors.length > 0 && (
                  <ul className="text-xs text-destructive list-disc pl-5 space-y-0.5">
                    {validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}
                  </ul>
                )}
                {validation.warnings.length > 0 && (
                  <ul className="text-xs text-amber-600 list-disc pl-5 space-y-0.5">
                    {validation.warnings.map((w, i) => <li key={i}>Aviso: {w.message}</li>)}
                  </ul>
                )}

                {validation.ok && validation.warnings.length > 0 && pendingOfx && (
                  <Button variant="outline" size="sm" onClick={handleForceDownload}>
                    <Download className="h-3 w-3 mr-2" />
                    Baixar mesmo com avisos
                  </Button>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" onClick={() => setCurrentStep('bank')}>
                Voltar
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Recomeçar
              </Button>
              <Button onClick={handleGenerateOFX} disabled={!!exportBlocked}>
                <ShieldCheck className="h-4 w-4 mr-2" />
                Validar e Baixar OFX
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Download */}
      {currentStep === 'download' && !loading && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 space-y-4">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-500" />
              <h3 className="text-xl font-semibold text-foreground">OFX gerado com sucesso</h3>
              <p className="text-sm text-muted-foreground">
                O arquivo <code className="text-primary">extrato_convertido.ofx</code> foi baixado.
              </p>
              <div className="flex justify-center gap-3 pt-4">
                <Button variant="outline" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Converter outro extrato
                </Button>
                <Button onClick={handleGenerateOFX}>
                  <Download className="h-4 w-4 mr-2" />
                  Baixar novamente
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

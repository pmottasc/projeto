import { useState, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { FileCog, Upload, Download, Loader2, X, ArrowRight, FileText } from 'lucide-react';

// Same map exposed by the edge function.
const CONVERSIONS: Record<string, string[]> = {
  pdf:  ['docx', 'xlsx', 'pptx', 'txt', 'jpg', 'png', 'html', 'rtf'],
  docx: ['pdf', 'txt', 'html', 'rtf', 'odt'],
  doc:  ['pdf', 'docx', 'txt', 'html', 'rtf'],
  xlsx: ['pdf', 'csv', 'html', 'xls'],
  xls:  ['pdf', 'xlsx', 'csv', 'html'],
  pptx: ['pdf', 'png', 'jpg', 'html'],
  ppt:  ['pdf', 'pptx', 'png', 'jpg'],
  csv:  ['xlsx', 'pdf', 'html'],
  rtf:  ['pdf', 'docx', 'txt', 'html'],
  odt:  ['pdf', 'docx', 'txt'],
  txt:  ['pdf', 'docx', 'html'],
  html: ['pdf', 'docx', 'png', 'jpg'],
  jpg:  ['pdf', 'png', 'webp'],
  jpeg: ['pdf', 'png', 'webp'],
  png:  ['pdf', 'jpg', 'webp'],
  webp: ['pdf', 'jpg', 'png'],
};

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF', docx: 'Word (.docx)', doc: 'Word (.doc)',
  xlsx: 'Excel (.xlsx)', xls: 'Excel (.xls)', csv: 'CSV',
  pptx: 'PowerPoint (.pptx)', ppt: 'PowerPoint (.ppt)',
  rtf: 'RTF', odt: 'OpenDocument (.odt)', txt: 'Texto (.txt)',
  html: 'HTML', jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP',
};

const ACCEPT = Object.keys(CONVERSIONS).map(e => `.${e}`).join(',');
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function DocumentConverter() {
  const { toast } = useToast();
  const { tenantId } = useTenant();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<string>('');
  const [converting, setConverting] = useState(false);

  const sourceExt = useMemo(() => (file ? getExt(file.name) : ''), [file]);
  const targets = useMemo(() => CONVERSIONS[sourceExt] || [], [sourceExt]);

  const handlePick = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_SIZE) {
      toast({ title: 'Arquivo muito grande', description: 'Tamanho máximo: 25MB.', variant: 'destructive' });
      return;
    }
    const ext = getExt(f.name);
    if (!CONVERSIONS[ext]) {
      toast({ title: 'Formato não suportado', description: `.${ext} não é aceito.`, variant: 'destructive' });
      return;
    }
    setFile(f);
    setTarget('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handlePick(f);
  };

  const reset = () => {
    setFile(null);
    setTarget('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const convert = async () => {
    if (!file || !target) return;
    setConverting(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('convert-document', {
        body: { fileBase64: base64, fileName: file.name, fromFormat: sourceExt, toFormat: target, tenant_id: tenantId },
      });
      if (error) throw new Error(error.message || 'Falha na conversão');
      if (data?.quota_exceeded) throw new Error(data.error || 'Limite mensal atingido. Faça upgrade do plano.');
      if (!data?.fileData) throw new Error(data?.error || 'Resposta inválida');

      // Trigger download
      const binary = atob(data.fileData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName || `convertido.${target}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Conversão concluída', description: `Arquivo ${data.fileName} baixado.` });
    } catch (err: any) {
      toast({ title: 'Erro na conversão', description: err.message || String(err), variant: 'destructive' });
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileCog className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-[24px] font-bold text-foreground tracking-tight">Conversor de Documentos</h1>
        </div>
        <p className="text-[13px] text-muted-foreground ml-13">
          Converta entre PDF, Word, Excel, PowerPoint, imagens e outros formatos. Máximo 25MB por arquivo.
        </p>
      </div>

      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-card hover:bg-accent/30 transition-colors cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={e => handlePick(e.target.files?.[0] || null)}
        />
        {!file ? (
          <>
            <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-[14px] font-medium text-foreground">Clique ou arraste um arquivo</p>
            <p className="text-[12px] text-muted-foreground mt-1">
              PDF, Word, Excel, PowerPoint, imagens, CSV, RTF, HTML…
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3" onClick={e => e.stopPropagation()}>
            <FileText className="h-8 w-8 text-primary" />
            <div className="text-left">
              <p className="text-[13px] font-medium text-foreground">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB · {FORMAT_LABELS[sourceExt] || sourceExt.toUpperCase()}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reset}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Conversion options */}
      {file && (
        <div className="bg-card rounded-xl border p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label className="section-heading">Formato origem</Label>
              <div className="h-10 px-3 rounded-md border bg-muted/30 flex items-center text-[13px] font-medium text-foreground">
                {FORMAT_LABELS[sourceExt] || sourceExt.toUpperCase()}
              </div>
            </div>
            <div className="flex justify-center pb-2">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="section-heading">Converter para</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-10 text-[13px]">
                  <SelectValue placeholder="Selecione o formato..." />
                </SelectTrigger>
                <SelectContent>
                  {targets.map(t => (
                    <SelectItem key={t} value={t}>{FORMAT_LABELS[t] || t.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={convert}
            disabled={!target || converting}
            className="w-full h-11"
          >
            {converting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Convertendo...</>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Converter e baixar</>
            )}
          </Button>
        </div>
      )}

      {/* Supported formats hint */}
      <div className="bg-accent/30 rounded-xl p-5">
        <p className="text-[12px] font-semibold text-foreground mb-2">Formatos suportados</p>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          <strong>Documentos:</strong> PDF, DOCX, DOC, RTF, ODT, TXT, HTML &nbsp;·&nbsp;
          <strong>Planilhas:</strong> XLSX, XLS, CSV &nbsp;·&nbsp;
          <strong>Apresentações:</strong> PPTX, PPT &nbsp;·&nbsp;
          <strong>Imagens:</strong> JPG, PNG, WEBP
        </p>
      </div>
    </div>
  );
}

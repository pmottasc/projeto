import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Brain, Loader2, Wrench, Send, Key, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  flowId: string;
  open: boolean;
  onClose: () => void;
}

const AVAILABLE_TOOLS: { key: string; label: string; desc: string }[] = [
  { key: 'create_ticket', label: 'Abrir Ticket', desc: 'Cria chamados automaticamente após coletar os dados.' },
  { key: 'lookup_ticket', label: 'Consultar Ticket', desc: 'Informa status de chamados pelo número.' },
  { key: 'handoff', label: 'Transferir para Humano', desc: 'Encaminha para o setor certo com resumo.' },
  { key: 'collect_contact_info', label: 'Coletar Dados', desc: 'Salva nome, CNPJ, e-mail no contato.' },
  { key: 'remember', label: 'Memória de Longo Prazo', desc: 'Lembra fatos do cliente entre conversas.' },
  { key: 'search_kb', label: 'Buscar na Base de Conhecimento', desc: 'Responde com base nos artigos cadastrados.' },
  { key: 'list_documents', label: 'Listar Documentos Disponíveis', desc: 'Mostra ao cliente as guias/documentos disponíveis no CNPJ no período. Use junto com "Enviar Documentos".' },
  { key: 'request_document', label: 'Enviar Documentos (Guias/Certidões)', desc: 'Busca documentos no sistema contábil pelo CNPJ e envia ao cliente. Requer configuração da API e cadastro CNPJ↔telefone.' },
];

const MODELS = [
  { v: 'google/gemini-2.5-flash-lite', label: 'Gemini Flash Lite — econômico (recomendado)' },
  { v: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview — equilibrado' },
  { v: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — mais robusto' },
  { v: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro — mais preciso (caro)' },
  { v: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { v: 'openai/gpt-5', label: 'GPT-5 (premium, mais caro)' },
];

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_MAX_TOKENS = 600;

const DEFAULT_TOOLS = ['create_ticket', 'lookup_ticket', 'handoff', 'collect_contact_info', 'remember', 'search_kb', 'list_documents', 'request_document'];

const DEFAULT_PERSONA = `Você é a Ana, assistente virtual da Tellcontab. Atende clientes pelo WhatsApp de forma educada, objetiva e prestativa.

Seu papel:
- Cumprimentar e identificar a necessidade do cliente
- Coletar nome, CNPJ e descrição do problema quando for abrir um chamado
- Consultar status de tickets quando solicitado
- Enviar guias, DAS, DARF, FGTS, GPS, certidões, holerites e documentos usando a ferramenta de documentos quando disponível
- Transferir para um atendente humano quando o assunto for sensível ou o cliente pedir

Regra importante: pedidos de guias/documentos não devem virar ticket automaticamente; solicite o CNPJ se necessário e use a ferramenta de envio de documentos.

Tom: profissional, caloroso, sem emojis em excesso. Respostas curtas (2-3 frases).`;

export default function AgentEditor({ flowId, open, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'flow' | 'agent'>('flow');
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_MAX_TOKENS);
  const [tools, setTools] = useState<string[]>(DEFAULT_TOOLS);
  const [handoffKw, setHandoffKw] = useState('humano, atendente, pessoa, operador');

  // Provedor de IA (Lovable padrão ou chave do cliente)
  const [apiProvider, setApiProvider] = useState<'lovable' | 'openai' | 'gemini' | 'custom'>('lovable');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Timeout de inatividade
  const [timeoutEnabled, setTimeoutEnabled] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(10);
  const [timeoutDeptId, setTimeoutDeptId] = useState<string>('none');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  // Test chat
  const [testMsg, setTestMsg] = useState('');
  const [testHistory, setTestHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open || !flowId) return;
    setLoading(true);
    void (async () => {
      const { data } = await supabase.from('chatbot_flows').select('*').eq('id', flowId).maybeSingle();
      if (data) {
        const f: any = data;
        setMode((f.mode as any) || 'flow');
        setPersona(f.agent_persona || DEFAULT_PERSONA);
        setModel(f.agent_model || DEFAULT_MODEL);
        setMaxTokens(Number(f.agent_max_tokens) > 0 ? Number(f.agent_max_tokens) : DEFAULT_MAX_TOKENS);
        setTools(f.agent_tools || DEFAULT_TOOLS);
        setHandoffKw((f.agent_handoff_keywords || []).join(', '));
        setTimeoutEnabled(f.inactivity_timeout_enabled !== false);
        setTimeoutMinutes(Number(f.inactivity_timeout_minutes) > 0 ? Number(f.inactivity_timeout_minutes) : 10);
        setTimeoutDeptId(f.inactivity_handoff_department_id || 'none');
        setApiProvider((f.agent_api_provider as any) || 'lovable');
        setApiKey(f.agent_api_key || '');
        setApiBaseUrl(f.agent_api_base_url || '');

        // Carregar setores do tenant do flow
        if (f.tenant_id) {
          const { data: deps } = await supabase
            .from('departments')
            .select('id, name')
            .eq('tenant_id', f.tenant_id)
            .eq('active', true)
            .order('name');
          setDepartments((deps as any) || []);
        }
      }
      setLoading(false);
    })();
  }, [open, flowId]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('chatbot_flows').update({
      mode,
      agent_persona: persona,
      agent_model: model,
      agent_max_tokens: Math.max(64, Math.min(2000, Number(maxTokens) || DEFAULT_MAX_TOKENS)),
      agent_tools: tools,
      agent_handoff_keywords: handoffKw.split(',').map(s => s.trim()).filter(Boolean),
      inactivity_timeout_enabled: timeoutEnabled,
      inactivity_timeout_minutes: Math.max(1, Math.min(1440, Number(timeoutMinutes) || 10)),
      inactivity_handoff_department_id: timeoutDeptId === 'none' ? null : timeoutDeptId,
      agent_api_provider: apiProvider,
      agent_api_key: apiProvider === 'lovable' ? null : (apiKey.trim() || null),
      agent_api_base_url: apiProvider === 'custom' ? (apiBaseUrl.trim() || null) : null,
    } as any).eq('id', flowId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Configuração do agente salva');
    onClose();
  };

  const toggleTool = (k: string) => {
    setTools(t => t.includes(k) ? t.filter(x => x !== k) : [...t, k]);
  };

  const sendTest = async () => {
    if (!testMsg.trim() || testing) return;
    const userMsg = testMsg.trim();
    setTestHistory(h => [...h, { role: 'user', content: userMsg }]);
    setTestMsg('');
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-agent-test', {
        body: {
          flow_id: flowId,
          persona, model, tools, handoff_keywords: handoffKw.split(',').map(s => s.trim()).filter(Boolean),
          api_provider: apiProvider,
          api_key: apiProvider === 'lovable' ? null : apiKey.trim(),
          api_base_url: apiProvider === 'custom' ? apiBaseUrl.trim() : null,
          history: [...testHistory, { role: 'user', content: userMsg }],
        },
      });
      if (error) throw error;
      const reply = (data as any)?.reply || '(sem resposta)';
      setTestHistory(h => [...h, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      toast.error(e.message || 'Falha no teste');
      setTestHistory(h => [...h, { role: 'assistant', content: '⚠️ Erro: ' + (e.message || 'desconhecido') }]);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-600" /> Agente IA do ChatBot
            <Badge variant="outline" className="ml-2 text-[10px]">Beta</Badge>
          </DialogTitle>
          <DialogDescription>
            Transforme este fluxo em um agente conversacional inteligente que entende linguagem natural e executa ações.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-5">
            {/* Mode toggle */}
            <div className="flex items-center justify-between p-4 rounded-lg border bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
              <div>
                <p className="font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  Modo Agente IA
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Quando ativo, o bot responde via IA em vez de seguir o fluxo visual rígido.
                </p>
              </div>
              <Switch checked={mode === 'agent'} onCheckedChange={(c) => setMode(c ? 'agent' : 'flow')} />
            </div>

            {/* Timeout de inatividade — vale para flow e agent */}
            <div className="p-4 rounded-lg border bg-gradient-to-br from-amber-500/5 to-orange-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Timeout de inatividade</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Se o cliente ficar sem responder pelo tempo abaixo, a conversa sai do bot e cai numa fila de atendimento.
                  </p>
                </div>
                <Switch checked={timeoutEnabled} onCheckedChange={setTimeoutEnabled} />
              </div>

              {timeoutEnabled && (
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <Label className="text-xs">Tempo sem resposta (minutos)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={timeoutMinutes}
                      onChange={e => setTimeoutMinutes(Number(e.target.value) || 10)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Encaminhar para o setor</Label>
                    <Select value={timeoutDeptId} onValueChange={setTimeoutDeptId}>
                      <SelectTrigger><SelectValue placeholder="Fila geral (sem setor)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Fila geral (sem setor)</SelectItem>
                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {mode === 'agent' && (
              <>
                <div className="rounded-xl border-2 border-indigo-500/30 bg-background p-4 shadow-sm">
                  <Label className="text-base font-semibold flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-indigo-600" />
                    Personalidade e instruções (script da IA)
                  </Label>
                  <Textarea
                    value={persona}
                    onChange={e => setPersona(e.target.value)}
                    rows={16}
                    spellCheck={false}
                    className="w-full text-sm leading-relaxed bg-background text-foreground border-2 border-input focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 rounded-lg p-4 resize-y min-h-[340px] shadow-inner antialiased"
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace', WebkitFontSmoothing: 'antialiased', textRendering: 'optimizeLegibility' }}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Defina nome, papel, tom e comportamento. O agente seguirá estas instruções em todas as conversas.
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <Label>Modelo de IA</Label>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODELS.map(m => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Modelos mais baratos = menor custo por mensagem. Lite atende a maioria dos casos.
                    </p>
                  </div>
                  <div>
                    <Label>Tokens máx por resposta</Label>
                    <Input
                      type="number"
                      min={64}
                      max={2000}
                      value={maxTokens}
                      onChange={e => setMaxTokens(Number(e.target.value) || DEFAULT_MAX_TOKENS)}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Limita o tamanho da resposta. Padrão 600 (~3-4 frases).
                    </p>
                  </div>
                </div>

                {/* Integração de API — Lovable ou chave do cliente */}
                <div className="rounded-xl border-2 border-emerald-500/30 bg-background p-4 shadow-sm space-y-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-emerald-600" />
                    <Label className="text-base font-semibold">Integração de API da IA</Label>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-2">
                    Use a API da Lovable (padrão, sem configuração extra) ou conecte a chave de IA paga/gratuita do cliente.
                  </p>

                  <div>
                    <Label className="text-xs">Provedor</Label>
                    <Select value={apiProvider} onValueChange={(v) => setApiProvider(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lovable">Lovable AI (padrão — já configurado)</SelectItem>
                        <SelectItem value="openai">OpenAI (chave do cliente)</SelectItem>
                        <SelectItem value="gemini">Google Gemini (chave do cliente)</SelectItem>
                        <SelectItem value="custom">Customizado (endpoint compatível com OpenAI)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {apiProvider !== 'lovable' && (
                    <>
                      <div>
                        <Label className="text-xs">Chave de API do cliente</Label>
                        <div className="flex gap-2">
                          <Input
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder={apiProvider === 'openai' ? 'sk-...' : apiProvider === 'gemini' ? 'AIza...' : 'sua chave de API'}
                            autoComplete="off"
                          />
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowApiKey(s => !s)}>
                            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          A chave é armazenada com segurança e usada somente nas chamadas do agente deste fluxo.
                        </p>
                      </div>

                      {apiProvider === 'custom' && (
                        <div>
                          <Label className="text-xs">URL base da API (compatível com OpenAI)</Label>
                          <Input
                            value={apiBaseUrl}
                            onChange={e => setApiBaseUrl(e.target.value)}
                            placeholder="https://api.exemplo.com/v1"
                          />
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Informe a URL base. Adicionaremos <code>/chat/completions</code> automaticamente se necessário.
                          </p>
                        </div>
                      )}

                      <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2">
                        Lembre-se de colocar no campo "Modelo de IA" acima o identificador exato aceito pelo provedor escolhido (ex.: <code>gpt-4o-mini</code>, <code>gemini-2.5-flash</code>).
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <Label>Palavras que forçam transferência humana</Label>
                  <Input value={handoffKw} onChange={e => setHandoffKw(e.target.value)} placeholder="humano, atendente" />
                </div>

                <div>
                  <Label className="flex items-center gap-2"><Wrench className="h-3.5 w-3.5" /> Ferramentas habilitadas</Label>
                  <div className="grid sm:grid-cols-2 gap-2 mt-2">
                    {AVAILABLE_TOOLS.map(t => {
                      const on = tools.includes(t.key);
                      return (
                        <button
                          key={t.key} type="button" onClick={() => toggleTool(t.key)}
                          className={`text-left p-3 rounded-lg border transition-all ${on ? 'border-indigo-500 bg-indigo-500/5' : 'border-border hover:border-muted-foreground/40'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t.label}</span>
                            <Switch checked={on} className="pointer-events-none" />
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">{t.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Test chat */}
                <div className="border rounded-lg p-3 bg-muted/30">
                  <Label className="flex items-center gap-2 mb-2">
                    <Send className="h-3.5 w-3.5" /> Testar agente (sandbox)
                  </Label>
                  <div className="bg-background rounded border p-2 mb-2 h-48 overflow-y-auto space-y-2">
                    {testHistory.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        Envie uma mensagem para testar como o agente responderia.
                      </p>
                    )}
                    {testHistory.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {testing && <div className="flex justify-start"><div className="bg-muted rounded-lg px-3 py-2"><Loader2 className="h-3 w-3 animate-spin" /></div></div>}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={testMsg} onChange={e => setTestMsg(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendTest()}
                      placeholder="Ex: Olá, preciso abrir um chamado..."
                      disabled={testing}
                    />
                    <Button onClick={sendTest} disabled={testing || !testMsg.trim()}>
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Modo simulação: nenhuma ferramenta é executada de verdade aqui.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

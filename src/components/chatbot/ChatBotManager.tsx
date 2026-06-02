import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Bot, Loader2, Edit3, Trash2, Wand2, X, ChevronRight, ChevronLeft, Sparkles, Settings2, Brain } from 'lucide-react';
import { toast } from 'sonner';
import FlowEditor from './FlowEditor';
import AgentEditor from './AgentEditor';

interface Flow {
  id: string;
  name: string;
  description: string;
  trigger_kind: 'any_message' | 'keyword' | 'first_contact' | 'manual';
  trigger_keywords: string[];
  active: boolean;
  updated_at: string;
  mode?: 'flow' | 'agent';
}

interface WizardOption {
  label: string;          // "Falar com Financeiro"
  department_id?: string; // setor de destino
  assignee_id?: string;   // atendente fixo (opcional)
  message?: string;       // mensagem antes da transferência
}

export default function ChatBotManager() {
  const { tenantId } = useTenant();
  const { user, isAdmin } = useAuth();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  const [agentFlowId, setAgentFlowId] = useState<string | null>(null);

  // New flow form
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [triggerKind, setTriggerKind] = useState<Flow['trigger_kind']>('any_message');
  const [keywords, setKeywords] = useState('');

  // Wizard state
  const [wStep, setWStep] = useState(1);
  const [wName, setWName] = useState('Atendimento URA');
  const [wTrigger, setWTrigger] = useState<Flow['trigger_kind']>('first_contact');
  const [wKeywords, setWKeywords] = useState('');
  const [wGreeting, setWGreeting] = useState('Olá! Bem-vindo à Tellcontab. 👋');
  const [wMenuQuestion, setWMenuQuestion] = useState('Em que podemos te ajudar hoje?');
  const [wOptions, setWOptions] = useState<WizardOption[]>([
    { label: 'Falar com Financeiro', message: 'Encaminhando para o Financeiro...' },
    { label: 'Falar com Suporte', message: 'Encaminhando para o Suporte...' },
  ]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from('chatbot_flows').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setFlows((data || []) as Flow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    void supabase.from('departments').select('id, name').eq('tenant_id', tenantId).eq('active', true).order('name')
      .then(({ data }) => setDepartments((data as any) || []));
    (async () => {
      const { data: tm } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId);
      const ids = (tm || []).map((m: any) => m.user_id);
      if (!ids.length) { setMembers([]); return; }
      const { data: profs } = await supabase.from('profiles').select('user_id, name').in('user_id', ids);
      setMembers(((profs as any) || []).map((p: any) => ({ user_id: p.user_id, name: p.name || 'Sem nome' })));
    })();
  }, [tenantId]);

  const create = async () => {
    if (!tenantId || !user || !name.trim()) return;
    const { data, error } = await supabase.from('chatbot_flows').insert({
      tenant_id: tenantId, name: name.trim(), description: desc.trim(),
      trigger_kind: triggerKind, created_by: user.id,
      trigger_keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
    }).select('*').maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setFlows(f => [data as Flow, ...f]);
      toast.success('Fluxo criado');
      setShowNew(false);
      setName(''); setDesc(''); setKeywords(''); setTriggerKind('any_message');
      setActiveFlow(data as Flow);
    }
  };

  // ============= WIZARD =============
  const buildFlowFromWizard = async () => {
    if (!tenantId || !user) return;
    if (!wName.trim() || wOptions.length === 0) { toast.error('Preencha o nome e ao menos uma opção'); return; }
    setCreating(true);
    try {
      // 1) flow
      const { data: flow, error: e1 } = await supabase.from('chatbot_flows').insert({
        tenant_id: tenantId, name: wName.trim(), description: 'Criado pelo Assistente',
        trigger_kind: wTrigger, created_by: user.id, active: true,
        trigger_keywords: wKeywords.split(',').map(k => k.trim()).filter(Boolean),
      }).select('*').maybeSingle();
      if (e1 || !flow) throw new Error(e1?.message || 'Falha ao criar fluxo');

      // 2) start node
      const { data: startN } = await supabase.from('chatbot_nodes').insert({
        tenant_id: tenantId, flow_id: flow.id, kind: 'start', label: 'Início',
        position_x: 50, position_y: 50,
      }).select('*').maybeSingle();

      // 3) greeting message
      let prevId = startN!.id;
      let prevHandle = '';
      let curY = 50;
      if (wGreeting.trim()) {
        const { data: g } = await supabase.from('chatbot_nodes').insert({
          tenant_id: tenantId, flow_id: flow.id, kind: 'message', label: 'Saudação',
          config: { text: wGreeting }, position_x: 50, position_y: 200,
        }).select('*').maybeSingle();
        await supabase.from('chatbot_edges').insert({
          tenant_id: tenantId, flow_id: flow.id,
          source_node_id: prevId, target_node_id: g!.id, source_handle: prevHandle,
        });
        prevId = g!.id; prevHandle = '';
        curY = 200;
      }

      // 4) menu
      const { data: menu } = await supabase.from('chatbot_nodes').insert({
        tenant_id: tenantId, flow_id: flow.id, kind: 'menu' as any, label: 'Menu Principal',
        config: { question: wMenuQuestion, options: wOptions.map(o => ({ label: o.label })) },
        position_x: 50, position_y: curY + 200,
      }).select('*').maybeSingle();
      await supabase.from('chatbot_edges').insert({
        tenant_id: tenantId, flow_id: flow.id,
        source_node_id: prevId, target_node_id: menu!.id, source_handle: prevHandle,
      });

      // 5) handoff por opção
      for (let i = 0; i < wOptions.length; i++) {
        const opt = wOptions[i];
        const { data: h } = await supabase.from('chatbot_nodes').insert({
          tenant_id: tenantId, flow_id: flow.id, kind: 'handoff', label: `→ ${opt.label}`,
          config: {
            text: opt.message || `Encaminhando para ${opt.label}...`,
            department_id: opt.department_id || '',
            assignee_id: opt.assignee_id || '',
          },
          position_x: 400 + (i * 280), position_y: curY + 200,
        }).select('*').maybeSingle();
        await supabase.from('chatbot_edges').insert({
          tenant_id: tenantId, flow_id: flow.id,
          source_node_id: menu!.id, target_node_id: h!.id, source_handle: `opt-${i}`,
        });
      }

      // 6) fallback: mensagem + volta pro menu
      const { data: fb } = await supabase.from('chatbot_nodes').insert({
        tenant_id: tenantId, flow_id: flow.id, kind: 'message', label: 'Resposta inválida',
        config: { text: 'Não entendi sua escolha. Por favor, responda com o número da opção.' },
        position_x: 50, position_y: curY + 480,
      }).select('*').maybeSingle();
      await supabase.from('chatbot_edges').insert({
        tenant_id: tenantId, flow_id: flow.id,
        source_node_id: menu!.id, target_node_id: fb!.id, source_handle: 'fallback',
      });
      await supabase.from('chatbot_edges').insert({
        tenant_id: tenantId, flow_id: flow.id,
        source_node_id: fb!.id, target_node_id: menu!.id, source_handle: '',
      });

      toast.success('Fluxo criado com sucesso! 🎉');
      setShowWizard(false);
      resetWizard();
      await load();
      setActiveFlow(flow as Flow);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar fluxo');
    } finally {
      setCreating(false);
    }
  };

  const resetWizard = () => {
    setWStep(1); setWName('Atendimento URA'); setWTrigger('first_contact');
    setWKeywords(''); setWGreeting('Olá! Bem-vindo à Tellcontab. 👋');
    setWMenuQuestion('Em que podemos te ajudar hoje?');
    setWOptions([
      { label: 'Falar com Financeiro', message: 'Encaminhando para o Financeiro...' },
      { label: 'Falar com Suporte', message: 'Encaminhando para o Suporte...' },
    ]);
  };

  const updateWOpt = (i: number, patch: Partial<WizardOption>) => {
    setWOptions(opts => opts.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  };
  const addWOpt = () => setWOptions(o => [...o, { label: `Opção ${o.length + 1}`, message: '' }]);
  const removeWOpt = (i: number) => setWOptions(o => o.filter((_, idx) => idx !== i));

  const toggleActive = async (f: Flow) => {
    await supabase.from('chatbot_flows').update({ active: !f.active }).eq('id', f.id);
    setFlows(fs => fs.map(x => x.id === f.id ? { ...x, active: !x.active } : x));
  };

  const remove = async (f: Flow) => {
    if (!confirm(`Excluir o fluxo "${f.name}"? Todos os nós serão perdidos.`)) return;
    await supabase.from('chatbot_flows').delete().eq('id', f.id);
    setFlows(fs => fs.filter(x => x.id !== f.id));
    toast.success('Fluxo excluído');
  };

  if (!isAdmin) {
    return (
      <Card className="p-12 text-center">
        <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="font-semibold mb-1">Acesso restrito</p>
        <p className="text-sm text-muted-foreground">Apenas administradores podem configurar fluxos do Chatbot.</p>
      </Card>
    );
  }

  if (activeFlow) {
    return <FlowEditor flowId={activeFlow.id} flowName={activeFlow.name} onBack={() => { setActiveFlow(null); void load(); }} />;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[40vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold">Fluxos do Chatbot</h3>
          <p className="text-sm text-muted-foreground">Automatize o primeiro contato no WhatsApp e direcione cada cliente para a pessoa certa.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { resetWizard(); setShowWizard(true); }} variant="default" className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
            <Wand2 className="h-4 w-4 mr-2" /> Assistente passo a passo
          </Button>
          <Button onClick={() => setShowNew(true)} variant="outline">
            <Plus className="h-4 w-4 mr-2" /> Fluxo em branco
          </Button>
        </div>
      </div>

      {flows.length === 0 ? (
        <Card className="p-12 text-center">
          <Sparkles className="h-12 w-12 mx-auto text-primary/60 mb-3" />
          <p className="font-semibold mb-1">Vamos criar seu primeiro chatbot?</p>
          <p className="text-sm text-muted-foreground mb-4">O Assistente cria um menu pronto que recebe o cliente e o transfere para o setor correto.</p>
          <Button onClick={() => { resetWizard(); setShowWizard(true); }} className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
            <Wand2 className="h-4 w-4 mr-2" /> Iniciar assistente
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map(f => (
            <Card key={f.id} className="p-4 space-y-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{f.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {f.trigger_kind === 'any_message' ? 'Qualquer mensagem' :
                       f.trigger_kind === 'keyword' ? `Palavras: ${f.trigger_keywords.join(', ')}` :
                       f.trigger_kind === 'first_contact' ? 'Primeiro contato' : 'Manual'}
                    </p>
                  </div>
                </div>
                <Switch checked={f.active} onCheckedChange={() => toggleActive(f)} />
              </div>
              {f.description && <p className="text-xs text-muted-foreground line-clamp-2">{f.description}</p>}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Badge variant={f.active ? 'default' : 'outline'} className="text-[10px]">
                  {f.active ? 'Ativo' : 'Inativo'}
                </Badge>
                {f.mode === 'agent' && (
                  <Badge className="text-[10px] bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-0">
                    <Brain className="h-2.5 w-2.5 mr-1" /> IA
                  </Badge>
                )}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAgentFlowId(f.id)} title="Configurar Agente IA">
                    <Brain className="h-3.5 w-3.5 text-indigo-600" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setActiveFlow(f)}>
                    <Edit3 className="h-3.5 w-3.5 mr-1" /> Editor
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(f)} className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog de fluxo em branco */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo fluxo de chatbot</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Atendimento inicial" />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="O que este fluxo faz?" />
            </div>
            <div>
              <Label>Quando disparar</Label>
              <Select value={triggerKind} onValueChange={v => setTriggerKind(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any_message">Qualquer mensagem recebida</SelectItem>
                  <SelectItem value="keyword">Por palavras-chave</SelectItem>
                  <SelectItem value="first_contact">No primeiro contato do cliente</SelectItem>
                  <SelectItem value="manual">Manual (atendente inicia)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {triggerKind === 'keyword' && (
              <div>
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="boleto, pagamento, fatura" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={create} disabled={!name.trim()}>Criar fluxo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIZARD */}
      <Dialog open={showWizard} onOpenChange={(o) => !o && setShowWizard(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-indigo-600" /> Assistente — passo {wStep} de 4
            </DialogTitle>
            <DialogDescription>
              Vamos montar um chatbot completo em 4 passos. Você pode refinar tudo no editor depois.
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-2 my-2">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`flex-1 h-2 rounded-full transition-colors ${s <= wStep ? 'bg-indigo-600' : 'bg-muted'}`} />
            ))}
          </div>

          <div className="space-y-4 py-2">
            {wStep === 1 && (
              <>
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Passo 1 — Identificação.</strong> Dê um nome ao fluxo e diga quando ele deve ser acionado.
                </div>
                <div>
                  <Label>Nome do fluxo</Label>
                  <Input value={wName} onChange={e => setWName(e.target.value)} placeholder="Atendimento URA" />
                </div>
                <div>
                  <Label>Quando o bot deve responder?</Label>
                  <Select value={wTrigger} onValueChange={v => setWTrigger(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_contact">No primeiro contato (recomendado)</SelectItem>
                      <SelectItem value="any_message">A qualquer mensagem recebida</SelectItem>
                      <SelectItem value="keyword">Apenas com palavras-chave</SelectItem>
                      <SelectItem value="manual">Manual (atendente dispara)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {wTrigger === 'keyword' && (
                  <div>
                    <Label>Palavras-chave (separadas por vírgula)</Label>
                    <Input value={wKeywords} onChange={e => setWKeywords(e.target.value)} placeholder="atendimento, oi, olá, menu" />
                  </div>
                )}
              </>
            )}

            {wStep === 2 && (
              <>
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Passo 2 — Saudação.</strong> Esta é a primeira mensagem que o cliente verá.
                </div>
                <div>
                  <Label>Mensagem de boas-vindas</Label>
                  <Textarea value={wGreeting} onChange={e => setWGreeting(e.target.value)} rows={4}
                    placeholder="Olá! Bem-vindo à Tellcontab. 👋" />
                  <p className="text-[11px] text-muted-foreground mt-1">Deixe vazio para pular esta etapa.</p>
                </div>
              </>
            )}

            {wStep === 3 && (
              <>
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Passo 3 — Menu de opções.</strong> O cliente verá uma pergunta com opções numeradas. Cada opção transferirá para o setor/atendente que você escolher no próximo passo.
                </div>
                <div>
                  <Label>Pergunta do menu</Label>
                  <Textarea value={wMenuQuestion} onChange={e => setWMenuQuestion(e.target.value)} rows={2}
                    placeholder="Em que podemos te ajudar hoje?" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Opções que aparecerão</Label>
                    <Button size="sm" variant="outline" onClick={addWOpt}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar opção
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {wOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs font-bold text-indigo-600 w-5 text-center">{i + 1}.</span>
                        <Input value={opt.label} onChange={e => updateWOpt(i, { label: e.target.value })}
                          placeholder="Falar com Financeiro" />
                        <Button size="icon" variant="ghost" onClick={() => removeWOpt(i)} className="h-8 w-8 text-destructive shrink-0">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {wStep === 4 && (
              <>
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Passo 4 — Para onde transferir.</strong> Para cada opção, escolha o setor e/ou um atendente específico.
                </div>
                {wOptions.map((opt, i) => (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-indigo-600">{i + 1}.</span> {opt.label || `Opção ${i + 1}`}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Setor</Label>
                        <Select value={opt.department_id || 'none'} onValueChange={v => updateWOpt(i, { department_id: v === 'none' ? '' : v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Sem setor" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem setor (fila geral)</SelectItem>
                            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Atendente fixo (opcional)</Label>
                        <Select value={opt.assignee_id || 'none'} onValueChange={v => updateWOpt(i, { assignee_id: v === 'none' ? '' : v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Qualquer" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Qualquer atendente</SelectItem>
                            {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Mensagem antes de transferir</Label>
                      <Input value={opt.message || ''} onChange={e => updateWOpt(i, { message: e.target.value })}
                        placeholder={`Encaminhando para ${opt.label}...`} />
                    </div>
                  </Card>
                ))}
                {departments.length === 0 && (
                  <p className="text-xs text-amber-600">⚠ Você ainda não tem setores. Crie em Configurações → Setores para usar essa funcionalidade.</p>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            {wStep > 1 && (
              <Button variant="outline" onClick={() => setWStep(s => s - 1)} disabled={creating}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
            )}
            <div className="flex-1" />
            {wStep < 4 ? (
              <Button onClick={() => setWStep(s => s + 1)} disabled={wStep === 1 && !wName.trim()}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={buildFlowFromWizard} disabled={creating} className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Criar fluxo
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {agentFlowId && (
        <AgentEditor flowId={agentFlowId} open={!!agentFlowId} onClose={() => { setAgentFlowId(null); void load(); }} />
      )}
    </div>
  );
}

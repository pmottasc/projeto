import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, GripVertical, Lightbulb, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface NodeEditorProps {
  open: boolean;
  onClose: () => void;
  node: { id: string; data: { kind: string; label: string; config: Record<string, any> } } | null;
  onSave: (label: string, config: Record<string, any>) => void;
  onDelete: () => void;
}

interface MenuOption { label: string; prefix?: string }

const NUMBERING_PRESETS: Record<string, (i: number) => string> = {
  number: (i) => `${i + 1}.`,
  emoji: (i) => ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'][i] || `${i + 1}️⃣`,
  letter: (i) => `${String.fromCharCode(65 + i)})`,
  arrow: (i) => `▶️ ${i + 1}`,
  bullet: () => '•',
  none: () => '',
};

const KIND_TITLE: Record<string, string> = {
  start: 'Início do fluxo',
  message: 'Enviar mensagem',
  question: 'Fazer uma pergunta',
  menu: 'Menu de opções (URA)',
  condition: 'Condição (se / então)',
  action: 'Executar ação',
  handoff: 'Transferir para atendente',
  end: 'Encerrar atendimento',
};
const KIND_DESC: Record<string, string> = {
  start: 'Ponto inicial. Toda execução começa por aqui.',
  message: 'Envia uma mensagem ao cliente e segue para o próximo passo.',
  question: 'Pergunta livre — guarda a resposta numa variável para uso posterior.',
  menu: 'Apresenta opções numeradas. Cada opção é um caminho diferente do fluxo.',
  condition: 'Decide o caminho com base no valor de uma variável.',
  action: 'Executa uma automação (tag, status, webhook).',
  handoff: 'Encerra o bot e direciona o cliente para um setor ou atendente humano.',
  end: 'Finaliza a conversa com o bot.',
};

export default function NodeEditor({ open, onClose, node, onSave, onDelete }: NodeEditorProps) {
  const { tenantId } = useTenant();
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; name: string }[]>([]);

  useEffect(() => {
    if (node) {
      setLabel(node.data.label || '');
      setConfig(node.data.config || {});
    }
  }, [node]);

  useEffect(() => {
    if (!tenantId) return;
    void supabase.from('departments').select('id, name').eq('tenant_id', tenantId).eq('active', true).order('name')
      .then(({ data }) => setDepartments((data as any) || []));

    // Load tenant members (atendentes) com seus nomes via profiles
    (async () => {
      const { data: tm } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId);
      const ids = (tm || []).map((m: any) => m.user_id);
      if (!ids.length) { setMembers([]); return; }
      const { data: profs } = await supabase.from('profiles').select('user_id, name').in('user_id', ids);
      setMembers(((profs as any) || []).map((p: any) => ({ user_id: p.user_id, name: p.name || 'Sem nome' })));
    })();
  }, [tenantId]);

  if (!node) return null;
  const kind = node.data.kind;

  const save = () => { onSave(label, config); onClose(); };

  // ===== Menu options helpers =====
  const options: MenuOption[] = Array.isArray(config.options) ? config.options : [];
  const setOptions = (opts: MenuOption[]) => setConfig({ ...config, options: opts });
  const addOption = () => setOptions([...options, { label: `Opção ${options.length + 1}` }]);
  const updateOption = (idx: number, patch: Partial<MenuOption>) => {
    const next = [...options]; next[idx] = { ...next[idx], ...patch }; setOptions(next);
  };
  const removeOption = (idx: number) => setOptions(options.filter((_, i) => i !== idx));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[440px] sm:max-w-[440px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{KIND_TITLE[kind] || kind}</SheetTitle>
          <SheetDescription className="text-xs">{KIND_DESC[kind]}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div>
            <Label>Nome interno</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Saudação inicial" />
            <p className="text-[11px] text-muted-foreground mt-1">Este nome só aparece para você no editor.</p>
          </div>

          {kind === 'start' && (
            <p className="text-xs text-muted-foreground bg-muted p-3 rounded">
              Este é o ponto de partida do fluxo. Toda execução começa aqui.
            </p>
          )}

          {kind === 'message' && (
            <div>
              <Label>Mensagem que será enviada ao cliente</Label>
              <Textarea
                value={config.text || ''}
                onChange={e => setConfig({ ...config, text: e.target.value })}
                rows={5}
                placeholder="Olá! Bem-vindo à Tellcontab. Como posso ajudar?"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Use <code>{'{{nome}}'}</code> para inserir variáveis coletadas.
              </p>
            </div>
          )}

          {kind === 'question' && (
            <>
              <div>
                <Label>Texto da pergunta</Label>
                <Textarea
                  value={config.text || config.question || ''}
                  onChange={e => setConfig({ ...config, text: e.target.value, question: e.target.value })}
                  rows={3}
                  placeholder="Qual o seu nome?"
                />
              </div>
              <div>
                <Label>Salvar resposta na variável</Label>
                <Input
                  value={config.variable || ''}
                  onChange={e => setConfig({ ...config, variable: e.target.value })}
                  placeholder="nome"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Você poderá reutilizar com <code>{'{{nome}}'}</code> em mensagens seguintes.
                </p>
              </div>
            </>
          )}

          {kind === 'menu' && (
            <>
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-md p-3 flex gap-2 text-xs">
                <Lightbulb className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-indigo-700 dark:text-indigo-300">Como funciona</p>
                  <p className="text-muted-foreground">
                    O bot envia a pergunta + as opções. O cliente responde com o número, a letra, o emoji ou uma palavra-chave da opção.
                    Cada opção tem uma <strong>saída própria</strong> — conecte ao próximo passo (outro <em>Menu</em> pra refinar, um <em>Transferir</em>, uma <em>Pergunta</em>, etc.).
                  </p>
                  <p className="text-muted-foreground">
                    <strong>Dica:</strong> pra escolher um atendente específico depois, ligue a saída desta opção a outro nó <em>Menu</em> (sub-menu) e cada sub-opção a um <em>Transferir</em> diferente.
                  </p>
                </div>
              </div>

              <div>
                <Label>Pergunta / título do menu</Label>
                <Textarea
                  value={config.question || ''}
                  onChange={e => setConfig({ ...config, question: e.target.value })}
                  rows={3}
                  placeholder="Olá! Em que podemos te ajudar hoje?"
                />
              </div>

              <div>
                <Label>Estilo de numeração</Label>
                <Select
                  value={config.numbering_style || 'number'}
                  onValueChange={(v) => setConfig({ ...config, numbering_style: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">1. 2. 3. (números simples)</SelectItem>
                    <SelectItem value="emoji">1️⃣ 2️⃣ 3️⃣ (emojis numéricos)</SelectItem>
                    <SelectItem value="letter">A) B) C) (letras)</SelectItem>
                    <SelectItem value="arrow">▶️ 1 ▶️ 2 (seta + número)</SelectItem>
                    <SelectItem value="bullet">• • • (bullets)</SelectItem>
                    <SelectItem value="none">Sem prefixo</SelectItem>
                    <SelectItem value="custom">Personalizado (definir em cada opção)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Você sempre pode sobrescrever o prefixo de uma opção individualmente abaixo.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Opções</Label>
                  <Button size="sm" variant="outline" onClick={addOption}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
                  </Button>
                </div>
                <div className="space-y-2">
                  {options.map((opt, i) => {
                    const style = (config.numbering_style as string) || 'number';
                    const auto = (NUMBERING_PRESETS[style] || NUMBERING_PRESETS.number)(i);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={opt.prefix ?? ''}
                          onChange={e => updateOption(i, { prefix: e.target.value })}
                          placeholder={auto || '(sem)'}
                          className="w-20 text-center font-mono"
                          title="Prefixo personalizado (deixe vazio para usar o padrão)"
                        />
                        <Input
                          value={opt.label}
                          onChange={e => updateOption(i, { label: e.target.value })}
                          placeholder={`Ex: Falar com Financeiro`}
                          className="flex-1"
                        />
                        <Button size="icon" variant="ghost" onClick={() => removeOption(i)} className="h-8 w-8 text-destructive shrink-0">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  {options.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">Nenhuma opção. Clique em "Adicionar".</p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  O bot aceita resposta por número, letra, emoji ou palavra-chave do rótulo. A alça <strong className="text-amber-600">amarela</strong> abaixo é o fallback (resposta inválida).
                </p>
              </div>

              <div>
                <Label>Salvar escolha na variável (opcional)</Label>
                <Input
                  value={config.variable || ''}
                  onChange={e => setConfig({ ...config, variable: e.target.value })}
                  placeholder="opcao_escolhida"
                />
              </div>
            </>
          )}

          {kind === 'condition' && (
            <>
              <div>
                <Label>Variável a comparar</Label>
                <Input
                  value={config.variable || ''}
                  onChange={e => setConfig({ ...config, variable: e.target.value })}
                  placeholder="ultima_mensagem"
                />
              </div>
              <div>
                <Label>Operador</Label>
                <Select value={config.operator || 'contains'} onValueChange={(v) => setConfig({ ...config, operator: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contém</SelectItem>
                    <SelectItem value="equals">É igual a</SelectItem>
                    <SelectItem value="starts_with">Começa com</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor</Label>
                <Input
                  value={config.value || ''}
                  onChange={e => setConfig({ ...config, value: e.target.value })}
                  placeholder="boleto"
                />
              </div>
            </>
          )}

          {kind === 'action' && (
            <>
              <div>
                <Label>Tipo de ação</Label>
                <Select
                  value={config.action_type || config.action || 'add_tag'}
                  onValueChange={(v) => setConfig({ ...config, action_type: v, action: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add_tag">Adicionar tag</SelectItem>
                    <SelectItem value="set_status">Mudar status</SelectItem>
                    <SelectItem value="webhook">Chamar webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor</Label>
                <Input
                  value={config.value || config.tag || ''}
                  onChange={e => setConfig({ ...config, value: e.target.value, tag: e.target.value })}
                  placeholder="financeiro"
                />
              </div>
            </>
          )}

          {kind === 'handoff' && (
            <>
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-md p-3 flex gap-2 text-xs">
                <Lightbulb className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  O bot pausa, envia a mensagem abaixo e direciona a conversa para o setor ou atendente escolhido.
                  Apenas o destino selecionado verá a conversa.
                </p>
              </div>

              <div>
                <Label>Mensagem ao cliente</Label>
                <Textarea
                  value={config.text || ''}
                  onChange={e => setConfig({ ...config, text: e.target.value })}
                  rows={3}
                  placeholder="Perfeito! Vou te transferir para um atendente. Aguarde só um instante."
                />
              </div>

              <div>
                <Label>Encaminhar para o setor</Label>
                <Select
                  value={config.department_id || 'none'}
                  onValueChange={(v) => setConfig({ ...config, department_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Nenhum (fila geral)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (fila geral)</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {departments.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">Nenhum setor cadastrado. Vá em Configurações → Setores.</p>
                )}
              </div>

              <div>
                <Label>Ou para um atendente específico (opcional)</Label>
                <Select
                  value={config.assignee_id || 'none'}
                  onValueChange={(v) => setConfig({ ...config, assignee_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Nenhum atendente fixo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (qualquer do setor)</SelectItem>
                    {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Se preencher, a conversa cairá direto para essa pessoa.
                </p>
              </div>
            </>
          )}

          {kind === 'end' && (
            <div>
              <Label>Mensagem de despedida (opcional)</Label>
              <Textarea
                value={config.text || ''}
                onChange={e => setConfig({ ...config, text: e.target.value })}
                rows={3}
                placeholder="Obrigado pelo contato. Até mais!"
              />
            </div>
          )}

          <div className="flex gap-2 pt-4 border-t sticky bottom-0 bg-background">
            <Button onClick={save} className="flex-1">Salvar</Button>
            {kind !== 'start' && (
              <Button variant="outline" onClick={onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

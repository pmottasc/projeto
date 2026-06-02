import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus, Save, Loader2, MessageCircle, HelpCircle, GitBranch, Zap, UserCheck, Square, ArrowLeft,
  ListChecks, HelpCircle as Help, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { FlowNode } from './FlowNode';
import NodeEditor from './NodeEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FlowEditorProps {
  flowId: string;
  flowName: string;
  onBack: () => void;
}

const NODE_TYPES = { default: FlowNode };

const PALETTE = [
  { kind: 'message', label: 'Mensagem', icon: MessageCircle, color: 'text-blue-600', tip: 'Envia um texto ao cliente.' },
  { kind: 'menu', label: 'Menu de opções', icon: ListChecks, color: 'text-indigo-600', tip: 'Apresenta opções (1, 2, 3) para o cliente escolher.' },
  { kind: 'question', label: 'Pergunta', icon: HelpCircle, color: 'text-purple-600', tip: 'Faz uma pergunta livre e guarda a resposta.' },
  { kind: 'condition', label: 'Condição', icon: GitBranch, color: 'text-amber-600', tip: 'Decide o caminho (se / então).' },
  { kind: 'action', label: 'Ação', icon: Zap, color: 'text-pink-600', tip: 'Adiciona tag, status, dispara webhook.' },
  { kind: 'handoff', label: 'Transferir', icon: UserCheck, color: 'text-orange-600', tip: 'Encaminha para setor ou atendente humano.' },
  { kind: 'end', label: 'Encerrar', icon: Square, color: 'text-red-600', tip: 'Finaliza a conversa com o bot.' },
];

function FlowEditorInner({ flowId, flowName, onBack }: FlowEditorProps) {
  const { tenantId } = useTenant();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingNode, setEditingNode] = useState<Node | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [nodesRes, edgesRes] = await Promise.all([
      supabase.from('chatbot_nodes').select('*').eq('flow_id', flowId),
      supabase.from('chatbot_edges').select('*').eq('flow_id', flowId),
    ]);

    let dbNodes = nodesRes.data || [];
    // Auto-create start node if empty
    if (dbNodes.length === 0) {
      const { data: startNode } = await supabase.from('chatbot_nodes').insert({
        tenant_id: tenantId, flow_id: flowId, kind: 'start', label: 'Início',
        position_x: 250, position_y: 50,
      }).select('*').maybeSingle();
      if (startNode) dbNodes = [startNode];
    }

    setNodes(dbNodes.map((n: any) => ({
      id: n.id,
      type: 'default',
      position: { x: n.position_x, y: n.position_y },
      data: { kind: n.kind, label: n.label, config: n.config || {} },
    })));
    setEdges((edgesRes.data || []).map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_handle || undefined,
      label: e.label || undefined,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
    })));
    setLoading(false);
  }, [flowId, tenantId, setNodes, setEdges]);

  useEffect(() => { void load(); }, [load]);

  const onConnect = useCallback(async (conn: Connection) => {
    if (!tenantId) return;
    const { data, error } = await supabase.from('chatbot_edges').insert({
      tenant_id: tenantId,
      flow_id: flowId,
      source_node_id: conn.source!,
      target_node_id: conn.target!,
      source_handle: conn.sourceHandle || '',
    }).select('*').maybeSingle();
    if (error || !data) { toast.error('Erro ao criar conexão'); return; }
    setEdges(eds => addEdge({
      ...conn,
      id: data.id,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
    }, eds));
  }, [flowId, tenantId, setEdges]);

  const addNode = async (kind: string) => {
    if (!tenantId) return;
    const initialConfig: Record<string, any> =
      kind === 'menu'
        ? { question: 'Olá! Em que podemos te ajudar hoje?', options: [{ label: 'Falar com Atendente' }, { label: 'Outro assunto' }] }
        : {};
    const { data, error } = await supabase.from('chatbot_nodes').insert({
      tenant_id: tenantId, flow_id: flowId, kind: kind as any,
      label: PALETTE.find(p => p.kind === kind)?.label || kind,
      config: initialConfig,
      position_x: 100 + Math.random() * 300,
      position_y: 200 + Math.random() * 200,
    }).select('*').maybeSingle();
    if (error || !data) { toast.error('Erro ao criar nó'); return; }
    setNodes(ns => [...ns, {
      id: data.id, type: 'default',
      position: { x: data.position_x, y: data.position_y },
      data: { kind: data.kind, label: data.label, config: data.config || {} },
    }]);
  };

  const saveLayout = async () => {
    setSaving(true);
    try {
      await Promise.all(nodes.map(n => supabase.from('chatbot_nodes').update({
        position_x: n.position.x, position_y: n.position.y,
      }).eq('id', n.id)));
      toast.success('Layout salvo');
    } finally { setSaving(false); }
  };

  const updateNode = async (label: string, config: Record<string, any>) => {
    if (!editingNode) return;
    await supabase.from('chatbot_nodes').update({ label, config }).eq('id', editingNode.id);
    setNodes(ns => ns.map(n => n.id === editingNode.id
      ? { ...n, data: { ...n.data, label, config } }
      : n));
    toast.success('Nó atualizado');
  };

  const deleteNode = async () => {
    if (!editingNode) return;
    if ((editingNode.data as any)?.kind === 'start') {
      toast.error('Não é possível remover o nó inicial'); return;
    }
    await supabase.from('chatbot_nodes').delete().eq('id', editingNode.id);
    setNodes(ns => ns.filter(n => n.id !== editingNode.id));
    setEdges(es => es.filter(e => e.source !== editingNode.id && e.target !== editingNode.id));
    setEditingNode(null);
    toast.success('Nó removido');
  };

  const onEdgeClick = useCallback(async (_: any, edge: Edge) => {
    if (!confirm('Remover esta conexão?')) return;
    await supabase.from('chatbot_edges').delete().eq('id', edge.id);
    setEdges(es => es.filter(e => e.id !== edge.id));
  }, [setEdges]);

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="h-[calc(100vh-260px)] min-h-[520px] flex gap-3 w-full overflow-hidden">
      {/* Palette */}
      <aside className="w-52 shrink-0 border border-border rounded-xl bg-card p-3 space-y-2 overflow-y-auto">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-full justify-start mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1 truncate">{flowName}</div>

        <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[11px] leading-relaxed">
          <p className="font-semibold text-primary mb-1 flex items-center gap-1"><Help className="h-3 w-3" /> Como montar</p>
          <p className="text-muted-foreground">
            1. Clique num bloco abaixo<br />
            2. Arraste das <strong>alças</strong> para conectar<br />
            3. Clique num nó para editar
          </p>
        </div>

        <div className="text-[10px] uppercase font-semibold text-muted-foreground px-1 pt-2">Adicionar bloco</div>
        {PALETTE.map(p => (
          <Popover key={p.kind}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => addNode(p.kind)}
              >
                <p.icon className={`h-4 w-4 mr-2 ${p.color}`} />
                <span className="flex-1 text-left">{p.label}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" className="w-56 text-xs">{p.tip}</PopoverContent>
          </Popover>
        ))}
        <div className="border-t border-border pt-2 mt-2">
          <Button onClick={saveLayout} disabled={saving} size="sm" className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" /> Salvar layout</>}
          </Button>
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 min-w-0 border border-border rounded-xl overflow-hidden bg-muted/20 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setEditingNode(n)}
          onEdgeClick={onEdgeClick}
          nodeTypes={NODE_TYPES}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {nodes.length <= 1 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur border border-border rounded-lg px-4 py-2 shadow-lg text-xs text-muted-foreground max-w-md text-center pointer-events-none">
            👈 Comece adicionando um bloco <strong>Menu de opções</strong> e conecte-o ao bloco <em>Início</em>.
          </div>
        )}
      </div>

      <NodeEditor
        open={!!editingNode}
        onClose={() => setEditingNode(null)}
        node={editingNode as any}
        onSave={updateNode}
        onDelete={deleteNode}
      />
    </div>
  );
}

export default function FlowEditor(props: FlowEditorProps) {
  return <ReactFlowProvider><FlowEditorInner {...props} /></ReactFlowProvider>;
}

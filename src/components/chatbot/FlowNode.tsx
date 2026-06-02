import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageCircle, HelpCircle, GitBranch, Zap, UserCheck, Square, Play, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON: Record<string, any> = {
  start: Play,
  message: MessageCircle,
  question: HelpCircle,
  menu: ListChecks,
  condition: GitBranch,
  action: Zap,
  handoff: UserCheck,
  end: Square,
};
const COLOR: Record<string, string> = {
  start: 'border-emerald-500/60 bg-emerald-500/5',
  message: 'border-blue-500/60 bg-blue-500/5',
  question: 'border-purple-500/60 bg-purple-500/5',
  menu: 'border-indigo-500/60 bg-indigo-500/5',
  condition: 'border-amber-500/60 bg-amber-500/5',
  action: 'border-pink-500/60 bg-pink-500/5',
  handoff: 'border-orange-500/60 bg-orange-500/5',
  end: 'border-red-500/60 bg-red-500/5',
};
const ICON_COLOR: Record<string, string> = {
  start: 'text-emerald-600',
  message: 'text-blue-600',
  question: 'text-purple-600',
  menu: 'text-indigo-600',
  condition: 'text-amber-600',
  action: 'text-pink-600',
  handoff: 'text-orange-600',
  end: 'text-red-600',
};
const KIND_LABEL: Record<string, string> = {
  start: 'Início',
  message: 'Mensagem',
  question: 'Pergunta',
  menu: 'Menu de Opções',
  condition: 'Condição',
  action: 'Ação',
  handoff: 'Transferir',
  end: 'Encerrar',
};

interface NodeData {
  kind: string;
  label: string;
  config?: Record<string, any>;
}

function FlowNodeBase({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const Icon = ICON[d.kind] || MessageCircle;
  const text = (d.config?.text as string) || (d.config?.message as string) || '';
  const options: { label: string; prefix?: string }[] = Array.isArray(d.config?.options) ? d.config!.options : [];
  const numStyle = (d.config?.numbering_style as string) || 'number';
  const prefixFor = (i: number, custom?: string) => {
    if (custom && custom.trim()) return custom.trim();
    if (numStyle === 'emoji') return ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'][i] || `${i + 1}️⃣`;
    if (numStyle === 'letter') return `${String.fromCharCode(65 + i)})`;
    if (numStyle === 'arrow') return `▶️${i + 1}`;
    if (numStyle === 'bullet') return '•';
    if (numStyle === 'none' || numStyle === 'custom') return '';
    return `${i + 1}.`;
  };

  return (
    <div className={cn(
      'rounded-lg border-2 bg-card shadow-md w-[240px] transition-all',
      COLOR[d.kind] || 'border-border',
      selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
    )}>
      {d.kind !== 'start' && (
        <Handle type="target" position={Position.Top} className="!bg-primary !w-3 !h-3 !border-2 !border-background" />
      )}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
        <Icon className={cn('h-4 w-4 shrink-0', ICON_COLOR[d.kind])} strokeWidth={2} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none truncate">{KIND_LABEL[d.kind] || d.kind}</span>
          <span className="text-xs font-semibold truncate leading-tight">{d.label || KIND_LABEL[d.kind]}</span>
        </div>
      </div>

      {d.kind === 'menu' ? (
        <div className="px-3 py-2 space-y-1">
          {(d.config?.question as string) && (
            <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2 break-words">{d.config?.question}</p>
          )}
          {options.length === 0 && (
            <p className="text-[11px] italic text-muted-foreground">Sem opções — clique para adicionar</p>
          )}
          <div className="space-y-1">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-1 text-[11px] bg-muted/50 rounded px-2 py-1 min-w-0">
                <span className="font-bold text-indigo-600 shrink-0">{prefixFor(i, opt.prefix)}</span>
                <span className="truncate flex-1 min-w-0">{opt.label || `Opção ${i + 1}`}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`opt-${i}`}
                  className="!bg-indigo-500 !w-3 !h-3 !border-2 !border-background !relative !top-auto !right-auto !transform-none"
                />
              </div>
            ))}
            <div className="flex items-center gap-1 text-[10px] italic text-muted-foreground bg-amber-500/10 rounded px-2 py-1 min-w-0">
              <span className="truncate flex-1 min-w-0">↳ outra resposta</span>
              <Handle
                type="source"
                position={Position.Right}
                id="fallback"
                className="!bg-amber-500 !w-3 !h-3 !border-2 !border-background !relative !top-auto !right-auto !transform-none"
              />
            </div>
          </div>
        </div>
      ) : (text || d.config?.question || d.config?.expression) ? (
        <div className="px-3 py-2 text-xs text-muted-foreground line-clamp-3">
          {text || d.config?.question || d.config?.expression}
        </div>
      ) : null}

      {d.kind === 'condition' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: '30%' }}
                  className="!bg-emerald-500 !w-3 !h-3 !border-2 !border-background" />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%' }}
                  className="!bg-red-500 !w-3 !h-3 !border-2 !border-background" />
          <div className="flex justify-between px-3 pb-1 text-[9px] text-muted-foreground">
            <span>✓ sim</span><span>✗ não</span>
          </div>
        </>
      ) : (d.kind !== 'end' && d.kind !== 'menu' && d.kind !== 'handoff') && (
        <Handle type="source" position={Position.Bottom} className="!bg-primary !w-3 !h-3 !border-2 !border-background" />
      )}
    </div>
  );
}

export const FlowNode = memo(FlowNodeBase);

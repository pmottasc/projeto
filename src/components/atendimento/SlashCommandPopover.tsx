import { useEffect, useRef } from 'react';
import type { MessageTemplate } from '@/lib/messages/types';

interface Props {
  open: boolean;
  templates: MessageTemplate[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onSelect: (t: MessageTemplate) => void;
  onClose: () => void;
}

export function SlashCommandPopover({ open, templates, activeIndex, setActiveIndex, onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const item = containerRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full mb-2 left-2 z-50 w-[28rem] max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 text-xs text-muted-foreground border-b flex items-center justify-between">
        <span>Mensagens prontas</span>
        <button className="text-xs hover:text-foreground" onClick={onClose}>Esc</button>
      </div>
      {templates.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground text-center">
          Nenhum modelo encontrado. Cadastre em "Mensagens Prontas".
        </div>
      ) : (
        <ul className="p-1">
          {templates.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                data-idx={i}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => onSelect(t)}
                className={`w-full text-left rounded-sm px-2 py-2 text-sm flex flex-col gap-0.5 ${i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
              >
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-primary">{t.shortcut}</code>
                  <span className="font-medium truncate">{t.title}</span>
                  <span className="ml-auto text-[10px] uppercase text-muted-foreground">{t.channel}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-muted">{t.category}</span>
                  <span className="truncate flex-1">{t.content.slice(0, 80)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

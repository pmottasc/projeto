import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  name?: string;
  recording?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Floating bubble shown inside the chat when the other side is typing or
 * recording (WhatsApp/Instagram-like indicator).
 */
export function TypingBubble({ name, recording, align = 'left', className }: Props) {
  return (
    <div
      className={cn(
        'flex w-full animate-fade-in',
        align === 'right' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      <div className="flex items-center gap-2 rounded-2xl bg-card border border-border shadow-sm px-3 py-2 text-xs text-muted-foreground">
        {recording ? (
          <>
            <Mic className="h-3.5 w-3.5 text-primary animate-pulse" />
            <span>{name ? `${name} está gravando áudio…` : 'gravando áudio…'}</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" />
            </span>
            <span>{name ? `${name} está digitando…` : 'digitando…'}</span>
          </>
        )}
      </div>
    </div>
  );
}

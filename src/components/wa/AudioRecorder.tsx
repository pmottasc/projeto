import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, X, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (blob: Blob, mimeType: string) => Promise<void> | void;
  disabled?: boolean;
}

function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return 'audio/webm';
}

export default function AudioRecorder({ onSend, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      stopStream();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopStream();
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (cancelledRef.current) {
          setRecording(false);
          setSeconds(0);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        setRecording(false);
        if (blob.size < 1000) {
          setSeconds(0);
          toast.error('Áudio muito curto');
          return;
        }
        setSending(true);
        try {
          await onSend(blob, mimeRef.current);
        } catch (e: any) {
          toast.error('Erro ao enviar áudio: ' + (e?.message || e));
        } finally {
          setSending(false);
          setSeconds(0);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (e: any) {
      toast.error('Não foi possível acessar o microfone: ' + (e?.message || e));
    }
  };

  const stop = (cancel = false) => {
    cancelledRef.current = cancel;
    try {
      recorderRef.current?.stop();
    } catch {
      stopStream();
      setRecording(false);
      setSeconds(0);
    }
  };

  if (sending) {
    return (
      <Button size="icon" variant="ghost" disabled className="h-10 w-10 shrink-0">
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  if (!recording) {
    return (
      <Button
        size="icon"
        variant="ghost"
        type="button"
        title="Gravar áudio"
        disabled={disabled}
        onClick={start}
        className="h-10 w-10 shrink-0"
      >
        <Mic className="h-4 w-4" />
      </Button>
    );
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="flex items-center gap-1.5 px-2 h-10 rounded-md border border-destructive/40 bg-destructive/5 shrink-0">
      <span className={cn('h-2 w-2 rounded-full bg-destructive animate-pulse')} />
      <span className="text-xs font-mono tabular-nums w-10">{mm}:{ss}</span>
      <Button size="icon" variant="ghost" type="button" title="Cancelar" onClick={() => stop(true)} className="h-7 w-7">
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" type="button" title="Enviar" onClick={() => stop(false)} className="h-7 w-7">
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

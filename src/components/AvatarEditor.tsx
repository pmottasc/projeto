import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  file: File | null;
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
}

const FRAME = 320; // visible square
const OUTPUT = 512; // exported size

export default function AvatarEditor({ file, open, onClose, onSave }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const baseScaleRef = useRef(1);

  useEffect(() => {
    if (!file) { setImgUrl(null); setImg(null); return; }
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const i = new Image();
    i.onload = () => {
      // base scale: cover the frame
      const s = Math.max(FRAME / i.width, FRAME / i.height);
      baseScaleRef.current = s;
      setImg(i);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    };
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(4, Math.max(1, z - e.deltaY * 0.002)));
  };

  const handleSave = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const scale = baseScaleRef.current * zoom;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      // top-left of image inside frame (frame centered at FRAME/2, image moved by pos)
      const left = FRAME / 2 - drawW / 2 + pos.x;
      const top = FRAME / 2 - drawH / 2 + pos.y;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d')!;
      const ratio = OUTPUT / FRAME;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, left * ratio, top * ratio, drawW * ratio, drawH * ratio);
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob(b => res(b!), 'image/jpeg', 0.9)
      );
      await onSave(blob);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const scale = baseScaleRef.current * zoom;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar foto de perfil</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative bg-muted overflow-hidden touch-none select-none"
            style={{ width: FRAME, height: FRAME, cursor: 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          >
            {imgUrl && img && (
              <img
                src={imgUrl}
                alt="preview"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: img.width * scale,
                  height: img.height * scale,
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                  maxWidth: 'none',
                }}
              />
            )}
            {/* Circular mask overlay */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                boxShadow: `0 0 0 9999px hsl(var(--background) / 0.7)`,
                borderRadius: '50%',
              }}
            />
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-primary" />
          </div>

          <div className="flex items-center gap-3 w-full">
            <ZoomOut className="h-4 w-4 text-muted-foreground" />
            <Slider
              min={1} max={4} step={0.01}
              value={[zoom]}
              onValueChange={(v) => setZoom(v[0])}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Arraste para reposicionar e use o controle (ou a roda do mouse) para ampliar.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !img}>
            {saving ? 'Salvando...' : 'Salvar foto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

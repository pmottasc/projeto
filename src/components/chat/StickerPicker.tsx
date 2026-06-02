import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface StickerItem {
  name: string;
  url: string;
}

interface Props {
  onPick: (url: string, name: string) => void;
}

export default function StickerPicker({ onPick }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    // list user's stickers + a "shared" folder
    const folders = user ? [user.id, 'shared'] : ['shared'];
    const all: StickerItem[] = [];
    for (const folder of folders) {
      const { data } = await supabase.storage.from('chat-stickers').list(folder, { limit: 100 });
      (data || []).forEach(f => {
        if (!f.name) return;
        const path = `${folder}/${f.name}`;
        all.push({ name: f.name, url: supabase.storage.from('chat-stickers').getPublicUrl(path).data.publicUrl });
      });
    }
    setItems(all);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const handleUpload = async (file: File) => {
    if (!user) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Figurinha muito grande (máx 2MB)'); return; }
    if (!file.type.startsWith('image/')) { toast.error('Envie uma imagem'); return; }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chat-stickers').upload(path, file, { upsert: false });
    setUploading(false);
    if (error) { toast.error('Falha no upload: ' + error.message); return; }
    toast.success('Figurinha adicionada!');
    void load();
  };

  return (
    <div className="w-72 h-80 flex flex-col">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <p className="text-xs font-semibold">Figurinhas</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />
        <Button size="sm" variant="ghost" className="h-7" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
          Enviar
        </Button>
      </div>
      <ScrollArea className="flex-1 p-2">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nenhuma figurinha ainda. Envie suas favoritas!
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((s, i) => (
              <button key={i} onClick={() => onPick(s.url, s.name)}
                className="aspect-square bg-muted rounded-md hover:ring-2 hover:ring-primary p-1 transition">
                <img src={s.url} alt={s.name} className="w-full h-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

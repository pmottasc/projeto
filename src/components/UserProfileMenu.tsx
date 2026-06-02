import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePresence, presenceColor, presenceLabel, type PresenceStatus } from '@/hooks/usePresence';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Camera, Circle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AvatarEditor from '@/components/AvatarEditor';

export default function UserProfileMenu() {
  const { user } = useAuth();
  const { manualStatus, setManualStatus, effectiveStatus } = usePresence();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('avatar_url').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
  }, [user]);

  const handlePickFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error('Imagem muito grande (máx 10MB)'); return; }
    if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem'); return; }
    setEditorFile(file);
    setEditorOpen(true);
  };

  const handleSaveCropped = async (blob: Blob) => {
    if (!user) return;
    const path = `${user.id}/avatar-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (upErr) { toast.error('Erro no upload: ' + upErr.message); throw upErr; }
    const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    // cache-bust to force refresh in <img>
    const url = `${publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', user.id);
    if (error) { toast.error('Erro ao salvar foto: ' + error.message); throw error; }
    setAvatarUrl(url);
    toast.success('Foto atualizada!');
  };

  const statuses: PresenceStatus[] = ['online', 'busy', 'away', 'invisible'];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative">
          <Avatar className="h-9 w-9">
            {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-[13px]">
              {user?.name?.charAt(0)?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', presenceColor(effectiveStatus))} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', presenceColor(effectiveStatus))} />
          {presenceLabel(effectiveStatus)}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {statuses.map(s => (
          <DropdownMenuItem key={s} onClick={() => setManualStatus(s === 'online' ? null : s)}>
            <Circle className={cn('h-3 w-3 mr-2 fill-current', {
              'text-green-500': s === 'online',
              'text-red-500': s === 'busy',
              'text-yellow-500': s === 'away',
              'text-gray-400': s === 'invisible',
            })} />
            {presenceLabel(s)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handlePickFile(f); e.target.value = ''; }} />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); fileRef.current?.click(); }}>
          <Camera className="h-4 w-4 mr-2" /> Alterar foto de perfil
        </DropdownMenuItem>
      </DropdownMenuContent>
      <AvatarEditor
        file={editorFile}
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditorFile(null); }}
        onSave={handleSaveCropped}
      />
    </DropdownMenu>
  );
}


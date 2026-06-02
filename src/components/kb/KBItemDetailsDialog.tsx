import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, User, Hash, Folder, FileText, Loader2 } from 'lucide-react';
import { KBPage } from './KBSidebar';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: KBPage | null;
  pages: KBPage[];
  canEdit: boolean;
  onSaved: () => void;
}

const EMOJI_PRESETS = [
  '📄','📝','📚','💡','🎯','🔧','⚙️','🚀','🌟','📊',
  '📁','📂','🗂️','🗃️','🗄️','🔒','✅','⚠️','❓','🏷️',
  '💼','📌','🎨','🧩','🛠️','🧠','📖','📕','📗','📘',
];

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR'); } catch { return d; }
}

export default function KBItemDetailsDialog({ open, onOpenChange, page, pages, canEdit, onSaved }: Props) {
  const [meta, setMeta] = useState<any>(null);
  const [creatorName, setCreatorName] = useState<string>('—');
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !page) return;
    setLoading(true);
    setTitle(page.title || '');
    setIcon(page.icon || '');
    (async () => {
      const { data } = await supabase.from('kb_pages')
        .select('id,title,icon,is_database,parent_id,created_at,updated_at,created_by,position')
        .eq('id', page.id).maybeSingle();
      setMeta(data);
      if (data?.created_by) {
        const { data: prof } = await supabase.from('profiles')
          .select('name,username').eq('user_id', data.created_by).maybeSingle();
        setCreatorName(prof?.name || prof?.username || '—');
      } else {
        setCreatorName('—');
      }
      setLoading(false);
    })();
  }, [open, page]);

  if (!page) return null;
  const isFolder = page.is_database;
  const childCount = pages.filter(p => p.parent_id === page.id).length;
  const parent = page.parent_id ? pages.find(p => p.id === page.parent_id) : null;

  const save = async () => {
    setSaving(true);
    await supabase.from('kb_pages').update({
      title: title || (isFolder ? 'Sem título (pasta)' : 'Sem título'),
      icon,
    } as any).eq('id', page.id);
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFolder ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            Propriedades — {isFolder ? 'Pasta' : 'Página'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Edit */}
            <div className="space-y-2">
              <Label className="text-xs">Ícone</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-2xl w-10 h-10 flex items-center justify-center border rounded">
                  {icon || (isFolder ? '📁' : '📄')}
                </div>
                <div className="grid grid-cols-10 gap-1 flex-1">
                  {EMOJI_PRESETS.map(e => (
                    <button
                      key={e}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setIcon(e)}
                      className={`text-lg hover:bg-muted rounded p-0.5 ${icon === e ? 'bg-muted ring-1 ring-primary' : ''}`}
                    >{e}</button>
                  ))}
                </div>
              </div>
              {canEdit && icon && (
                <button onClick={() => setIcon('')} className="text-[11px] text-muted-foreground hover:text-foreground">
                  Remover ícone
                </button>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Nome</Label>
              <Input
                value={title}
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isFolder ? 'Nome da pasta' : 'Nome da página'}
              />
            </div>

            {/* Info */}
            <div className="border-t pt-3 space-y-2 text-[12px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span>Criado por:</span>
                <span className="text-foreground font-medium">{creatorName}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Criado em:</span>
                <span className="text-foreground">{formatDate(meta?.created_at)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Última atualização:</span>
                <span className="text-foreground">{formatDate(meta?.updated_at)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                <span>ID:</span>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{page.id}</code>
              </div>
              {parent && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Folder className="h-3.5 w-3.5" />
                  <span>Dentro de:</span>
                  <span className="text-foreground">{parent.icon} {parent.title || 'Sem título'}</span>
                </div>
              )}
              {isFolder && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Itens dentro:</span>
                  <span className="text-foreground font-medium">{childCount}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {canEdit && (
            <Button onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

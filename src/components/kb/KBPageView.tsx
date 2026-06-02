import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import KBBlockEditor, { Block } from './KBBlockEditor';
import KBFolderView from './KBFolderView';
import { ChevronRight, Smile } from 'lucide-react';
import { KBPage } from './KBSidebar';

interface Props {
  pageId: string;
  pages: KBPage[];
  canEdit: boolean;
  onPageUpdated: () => void;
  onSelectPage: (id: string) => void;
}

const EMOJI_PRESETS = [
  '📄', '📝', '📚', '💡', '🎯', '🔧', '⚙️', '🚀', '🌟', '📊',
  '📁', '📂', '🗂️', '🗃️', '🗄️', '🔒', '✅', '⚠️', '❓', '🏷️',
  '💼', '📌', '🎨', '🧩', '🛠️', '🧠', '📖', '📕', '📗', '📘',
  '🌐', '💻', '📱', '🖥️', '⌨️', '🖱️', '💾', '🔍', '🔔', '⭐',
];

function buildBreadcrumb(pages: KBPage[], pageId: string): KBPage[] {
  const map = new Map(pages.map(p => [p.id, p]));
  const out: KBPage[] = [];
  let cur = map.get(pageId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return out;
}

export default function KBPageView({ pageId, pages, canEdit, onPageUpdated, onSelectPage }: Props) {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [page, setPage] = useState<KBPage | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const load = useCallback(async () => {
    const [{ data: pg }, { data: bl }] = await Promise.all([
      supabase.from('kb_pages').select('*').eq('id', pageId).single(),
      supabase.from('kb_blocks').select('*').eq('page_id', pageId).order('position'),
    ]);
    setPage(pg as any);
    setTitleDraft((pg as any)?.title || '');
    setBlocks((bl as any) || []);
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  if (!page) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const crumbs = buildBreadcrumb(pages, pageId);
  const children = pages.filter(p => p.parent_id === pageId);
  const isFolder = page.is_database; // repurposed flag

  const updatePage = async (patch: Partial<KBPage>) => {
    await supabase.from('kb_pages').update(patch as any).eq('id', pageId);
    onPageUpdated(); load();
  };

  const createChild = async (asFolder: boolean) => {
    if (!user) return;
    const { data } = await supabase.from('kb_pages').insert({
      tenant_id: requireTenantId(tenantId),
      parent_id: pageId,
      title: '',
      icon: asFolder ? '📁' : '',
      is_database: asFolder,
      position: children.length,
      created_by: user.id,
    } as any).select().single();
    onPageUpdated();
    if (data) onSelectPage((data as any).id);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Breadcrumb */}
      <div className="px-12 py-2 border-b bg-background sticky top-0 z-10 flex items-center gap-1 text-[12px] text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button onClick={() => onSelectPage(c.id)} className="hover:text-foreground truncate max-w-[200px]">
              {c.icon && <span className="mr-1">{c.icon}</span>}
              {c.title || 'Sem título'}
            </button>
          </span>
        ))}
      </div>

      <div className="max-w-3xl mx-auto px-12 py-10">
        {/* Icon + Title */}
        <div className="mb-4 relative">
          <button
            disabled={!canEdit}
            onClick={() => setShowEmoji(s => !s)}
            className="text-5xl mb-2 hover:bg-muted rounded p-1 transition-colors"
          >
            {page.icon || (canEdit ? <Smile className="h-10 w-10 text-muted-foreground/40" /> : (isFolder ? '📁' : '📄'))}
          </button>
          {showEmoji && (
            <div className="absolute z-20 bg-popover border rounded-lg shadow-lg p-2 grid grid-cols-10 gap-1 w-72">
              {EMOJI_PRESETS.map(e => (
                <button key={e} onClick={() => { updatePage({ icon: e }); setShowEmoji(false); }}
                  className="text-xl hover:bg-muted rounded p-1">{e}</button>
              ))}
              <button onClick={() => { updatePage({ icon: '' }); setShowEmoji(false); }}
                className="col-span-10 text-[11px] text-muted-foreground hover:bg-muted rounded p-1 mt-1">Remover</button>
            </div>
          )}
          <input
            value={titleDraft}
            disabled={!canEdit}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft !== page.title && updatePage({ title: titleDraft || (isFolder ? 'Sem título (pasta)' : 'Sem título') })}
            placeholder={isFolder ? 'Nome da pasta' : 'Sem título'}
            className="text-4xl font-bold bg-transparent outline-none w-full placeholder:text-muted-foreground/30"
          />
        </div>

        {/* Folder view shows children; page view shows blocks */}
        {isFolder ? (
          <KBFolderView
            children={children}
            canEdit={canEdit}
            onSelectPage={onSelectPage}
            onCreate={createChild}
          />
        ) : (
          <KBBlockEditor pageId={pageId} blocks={blocks} canEdit={canEdit} onChange={load} />
        )}
      </div>
    </div>
  );
}

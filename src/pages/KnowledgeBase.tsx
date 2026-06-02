import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import KBSidebar, { KBPage } from '@/components/kb/KBSidebar';
import KBPageView from '@/components/kb/KBPageView';
import { BookOpen } from 'lucide-react';

export default function KnowledgeBase() {
  const { user, isAdmin } = useAuth();
  const { tenantId } = useTenant();
  const [pages, setPages] = useState<KBPage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('kb_pages').select('id,parent_id,title,icon,is_database,position,database_view')
      .is('archived_at', null).order('position');
    const list = (data as KBPage[]) || [];
    setPages(list);
    setActiveId(prev => prev && list.find(p => p.id === prev) ? prev : (list[0]?.id ?? null));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener('kb:refresh', h);
    return () => window.removeEventListener('kb:refresh', h);
  }, [load]);

  const handleCreate = async (parentId: string | null, isFolder = false) => {
    if (!user) return;
    const tid = requireTenantId(tenantId);
    const siblings = pages.filter(p => p.parent_id === parentId);
    const { data } = await supabase.from('kb_pages').insert({
      tenant_id: tid, parent_id: parentId, title: '',
      icon: isFolder ? '📁' : '',
      is_database: isFolder, // flag repurposed: true = folder
      position: siblings.length, created_by: user.id,
    } as any).select().single();
    await load();
    if (data) setActiveId((data as any).id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este item e todo o seu conteúdo?')) return;
    await supabase.from('kb_pages').delete().eq('id', id);
    if (activeId === id) setActiveId(null);
    load();
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 lg:-m-8 animate-fade-in">
      <KBSidebar
        pages={pages}
        activeId={activeId}
        isAdmin={isAdmin}
        onSelect={setActiveId}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />
      <main className="flex-1 flex flex-col bg-background min-w-0">
        {activeId ? (
          <KBPageView
            pageId={activeId}
            pages={pages}
            canEdit={isAdmin}
            onPageUpdated={load}
            onSelectPage={setActiveId}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-semibold mb-1">Base de Conhecimento</h2>
            <p className="text-[13px] text-muted-foreground max-w-md">
              {isAdmin
                ? 'Selecione uma página na barra lateral ou crie uma nova clicando em + no topo.'
                : 'Nenhuma página foi criada ainda.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

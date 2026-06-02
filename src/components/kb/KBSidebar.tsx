import { useState } from 'react';
import { ChevronRight, Plus, FileText, MoreHorizontal, Trash2, Folder, FolderOpen, Pencil, Info, FilePlus, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import KBItemDetailsDialog from './KBItemDetailsDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface KBPage {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string;
  is_database: boolean; // repurposed: true = folder
  position: number;
  database_view?: string;
}

interface Props {
  pages: KBPage[];
  activeId: string | null;
  isAdmin: boolean;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null, isFolder?: boolean) => void;
  onDelete: (id: string) => void;
}

function buildTree(pages: KBPage[]): Record<string, KBPage[]> {
  const map: Record<string, KBPage[]> = {};
  for (const p of pages) {
    const k = p.parent_id ?? '__root__';
    (map[k] ||= []).push(p);
  }
  Object.values(map).forEach(list => list.sort((a, b) => {
    if (a.is_database !== b.is_database) return a.is_database ? -1 : 1;
    return a.position - b.position || a.title.localeCompare(b.title);
  }));
  return map;
}

interface ItemActions {
  openDetails: () => void;
  remove: () => void;
  createPage: () => void;
  createFolder: () => void;
}

function ItemMenuItems({ isFolder, isAdmin, actions }: { isFolder: boolean; isAdmin: boolean; actions: ItemActions }) {
  return (
    <>
      <DropdownMenuItem onClick={actions.openDetails}>
        <Info className="h-3.5 w-3.5 mr-2" /> Ver propriedades
      </DropdownMenuItem>
      {isAdmin && (
        <>
          <DropdownMenuItem onClick={actions.openDetails}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear / Editar ícone
          </DropdownMenuItem>
          {isFolder && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={actions.createPage}>
                <FilePlus className="h-3.5 w-3.5 mr-2" /> Nova página dentro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={actions.createFolder}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> Nova subpasta
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={actions.remove} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir {isFolder ? 'pasta' : 'página'}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function ContextMenuItemsFor({ isFolder, isAdmin, actions }: { isFolder: boolean; isAdmin: boolean; actions: ItemActions }) {
  return (
    <>
      <ContextMenuItem onClick={actions.openDetails}>
        <Info className="h-3.5 w-3.5 mr-2" /> Ver propriedades
      </ContextMenuItem>
      {isAdmin && (
        <>
          <ContextMenuItem onClick={actions.openDetails}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear / Editar ícone
          </ContextMenuItem>
          {isFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={actions.createPage}>
                <FilePlus className="h-3.5 w-3.5 mr-2" /> Nova página dentro
              </ContextMenuItem>
              <ContextMenuItem onClick={actions.createFolder}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> Nova subpasta
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={actions.remove} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir {isFolder ? 'pasta' : 'página'}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

function isDescendant(pages: KBPage[], ancestorId: string, candidateId: string): boolean {
  const map = new Map(pages.map(p => [p.id, p]));
  let cur = map.get(candidateId);
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return false;
}

async function movePage(pageId: string, newParentId: string | null, allPages: KBPage[]) {
  const siblings = allPages.filter(p => p.parent_id === newParentId && p.id !== pageId);
  const { error } = await supabase.from('kb_pages').update({
    parent_id: newParentId,
    position: siblings.length,
  } as any).eq('id', pageId);
  if (error) {
    toast.error('Não foi possível mover');
    return false;
  }
  toast.success('Movido');
  window.dispatchEvent(new Event('kb:refresh'));
  return true;
}

function PageNode({
  page, tree, depth, activeId, isAdmin, allPages, onSelect, onCreate, onDelete, onOpenDetails,
}: {
  page: KBPage; tree: Record<string, KBPage[]>; depth: number;
  activeId: string | null; isAdmin: boolean; allPages: KBPage[];
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null, isFolder?: boolean) => void;
  onDelete: (id: string) => void;
  onOpenDetails: (page: KBPage) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const children = tree[page.id] || [];
  const hasChildren = children.length > 0;
  const isActive = page.id === activeId;
  const isFolder = page.is_database;

  const actions: ItemActions = {
    openDetails: () => onOpenDetails(page),
    remove: () => onDelete(page.id),
    createPage: () => { onCreate(page.id, false); setOpen(true); },
    createFolder: () => { onCreate(page.id, true); setOpen(true); },
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!isAdmin) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-kb-page', page.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isAdmin || !e.dataTransfer.types.includes('application/x-kb-page')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const draggedId = e.dataTransfer.getData('application/x-kb-page');
    if (!draggedId || draggedId === page.id) return;
    if (isDescendant(allPages, draggedId, page.id)) {
      toast.error('Não é possível mover para dentro de si mesmo');
      return;
    }
    const newParentId = isFolder ? page.id : page.parent_id;
    await movePage(draggedId, newParentId, allPages);
    if (isFolder) setOpen(true);
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable={isAdmin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`group flex items-center gap-0.5 rounded-md px-1 py-1 cursor-pointer hover:bg-muted/60 ${isActive ? 'bg-muted' : ''} ${dragOver ? (isFolder ? 'ring-2 ring-primary bg-primary/10' : 'ring-1 ring-primary/50') : ''}`}
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => onSelect(page.id)}
          >
            <button
              className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
              onClick={(e) => { e.stopPropagation(); if (isFolder || hasChildren) setOpen(o => !o); }}
            >
              {isFolder || hasChildren ? (
                <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
              ) : <span className="h-3 w-3" />}
            </button>
            <span className="text-sm shrink-0 w-5 text-center">
              {page.icon ? page.icon : (
                isFolder
                  ? (open ? <FolderOpen className="h-3.5 w-3.5 inline text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 inline text-muted-foreground" />)
                  : <FileText className="h-3.5 w-3.5 inline text-muted-foreground" />
              )}
            </span>
            <span className="text-[13px] truncate flex-1">{page.title || (isFolder ? 'Sem título (pasta)' : 'Sem título')}</span>
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button onClick={e => e.stopPropagation()} className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted-foreground/15">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={e => e.stopPropagation()} className="w-56">
                  <ItemMenuItems isFolder={isFolder} isAdmin={isAdmin} actions={actions} />
                </DropdownMenuContent>
              </DropdownMenu>
              {isAdmin && isFolder && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreate(page.id, false); setOpen(true); }}
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted-foreground/15"
                  title="Adicionar página"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItemsFor isFolder={isFolder} isAdmin={isAdmin} actions={actions} />
        </ContextMenuContent>
      </ContextMenu>

      {open && hasChildren && (
        <div>
          {children.map(c => (
            <PageNode key={c.id} page={c} tree={tree} depth={depth + 1}
              activeId={activeId} isAdmin={isAdmin} allPages={allPages}
              onSelect={onSelect} onCreate={onCreate} onDelete={onDelete} onOpenDetails={onOpenDetails} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function KBSidebar({ pages, activeId, isAdmin, onSelect, onCreate, onDelete }: Props) {
  const tree = buildTree(pages);
  const roots = tree['__root__'] || [];
  const [detailsPage, setDetailsPage] = useState<KBPage | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);

  const handleRootDragOver = (e: React.DragEvent) => {
    if (!isAdmin || !e.dataTransfer.types.includes('application/x-kb-page')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRootDragOver(true);
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const draggedId = e.dataTransfer.getData('application/x-kb-page');
    if (!draggedId) return;
    await movePage(draggedId, null, pages);
  };

  return (
    <aside className="w-64 shrink-0 border-r bg-muted/20 flex flex-col h-full">
      <div className="px-3 py-3 border-b flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</span>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6"><Plus className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onCreate(null, false)}>
                <FileText className="h-3.5 w-3.5 mr-2" /> Nova página
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate(null, true)}>
                <Folder className="h-3.5 w-3.5 mr-2" /> Nova pasta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div
        className={`flex-1 overflow-y-auto py-2 px-1 ${rootDragOver ? 'bg-primary/5 ring-1 ring-primary/30 rounded' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={handleRootDrop}
      >
        {roots.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-8 px-4">
            {isAdmin ? 'Clique em + para criar sua primeira página ou pasta.' : 'Nenhum item ainda.'}
          </p>
        ) : (
          roots.map(p => (
            <PageNode key={p.id} page={p} tree={tree} depth={0}
              activeId={activeId} isAdmin={isAdmin} allPages={pages}
              onSelect={onSelect} onCreate={onCreate} onDelete={onDelete}
              onOpenDetails={setDetailsPage} />
          ))
        )}
      </div>

      <KBItemDetailsDialog
        open={!!detailsPage}
        onOpenChange={(o) => !o && setDetailsPage(null)}
        page={detailsPage}
        pages={pages}
        canEdit={isAdmin}
        onSaved={() => { /* parent will reload via realtime/manual; trigger update */ window.dispatchEvent(new Event('kb:refresh')); }}
      />
    </aside>
  );
}

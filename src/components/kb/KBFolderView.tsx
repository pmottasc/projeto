import { FileText, Folder as FolderIcon, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KBPage } from './KBSidebar';

interface Props {
  children: KBPage[];
  canEdit: boolean;
  onSelectPage: (id: string) => void;
  onCreate: (isFolder: boolean) => void;
}

export default function KBFolderView({ children, canEdit, onSelectPage, onCreate }: Props) {
  // Sort: folders first
  const sorted = [...children].sort((a, b) => {
    if (a.is_database !== b.is_database) return a.is_database ? -1 : 1;
    return a.position - b.position || a.title.localeCompare(b.title);
  });

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conteúdo da pasta
        </span>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onCreate(false)}>
                <FileText className="h-3.5 w-3.5 mr-2" /> Nova página
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate(true)}>
                <FolderIcon className="h-3.5 w-3.5 mr-2" /> Nova pasta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="border border-dashed rounded-lg py-12 text-center text-[13px] text-muted-foreground">
          Pasta vazia. {canEdit && 'Use "Adicionar" para criar páginas ou subpastas.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {sorted.map(c => (
            <button
              key={c.id}
              onClick={() => onSelectPage(c.id)}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <span className="text-2xl shrink-0 w-8 text-center">
                {c.icon || (c.is_database
                  ? <FolderIcon className="h-5 w-5 inline text-muted-foreground" />
                  : <FileText className="h-5 w-5 inline text-muted-foreground" />)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">
                  {c.title || (c.is_database ? 'Pasta sem título' : 'Sem título')}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {c.is_database ? 'Pasta' : 'Página'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

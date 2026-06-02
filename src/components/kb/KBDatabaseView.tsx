import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import {
  Plus, X, Type, Hash, Calendar, Tag, CheckSquare, Link as LinkIcon,
  ListChecks, User, Table as TableIcon, LayoutGrid, List as ListIcon, MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { KBPage } from './KBSidebar';

interface PropDef {
  id: string;
  database_page_id: string;
  name: string;
  type: string;
  options: any;
  position: number;
}

interface Props {
  databasePage: KBPage;
  rows: KBPage[];
  canEdit: boolean;
  onSelectPage: (id: string) => void;
  onCreateRow: () => void;
  onViewChange: (view: string) => void;
}

const PROP_TYPES = [
  { type: 'text', label: 'Texto', icon: Type },
  { type: 'number', label: 'Número', icon: Hash },
  { type: 'select', label: 'Seleção', icon: Tag },
  { type: 'multi_select', label: 'Multi-seleção', icon: ListChecks },
  { type: 'status', label: 'Status', icon: Tag },
  { type: 'date', label: 'Data', icon: Calendar },
  { type: 'checkbox', label: 'Caixa de seleção', icon: CheckSquare },
  { type: 'url', label: 'URL', icon: LinkIcon },
  { type: 'person', label: 'Pessoa', icon: User },
];

const VIEWS = [
  { key: 'table', label: 'Tabela', icon: TableIcon },
  { key: 'list', label: 'Lista', icon: ListIcon },
  { key: 'gallery', label: 'Galeria', icon: LayoutGrid },
];

export default function KBDatabaseView({
  databasePage, rows, canEdit, onSelectPage, onCreateRow, onViewChange,
}: Props) {
  const { tenantId } = useTenant();
  const [defs, setDefs] = useState<PropDef[]>([]);
  // values: { [pageId]: { [defId]: value } }
  const [values, setValues] = useState<Record<string, Record<string, any>>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');
  const view = databasePage.database_view || 'table';

  const load = async () => {
    const { data: d } = await supabase
      .from('kb_page_property_defs')
      .select('*')
      .eq('database_page_id', databasePage.id)
      .order('position');
    setDefs((d as any) || []);

    if (rows.length) {
      const ids = rows.map(r => r.id);
      const { data: v } = await supabase
        .from('kb_page_property_values')
        .select('*')
        .in('page_id', ids);
      const map: Record<string, Record<string, any>> = {};
      (v || []).forEach((x: any) => {
        (map[x.page_id] ||= {})[x.property_def_id] = x.value;
      });
      setValues(map);
    } else {
      setValues({});
    }
  };

  useEffect(() => { load(); }, [databasePage.id, rows.length]);

  const setValue = async (pageId: string, defId: string, value: any) => {
    setValues(prev => ({ ...prev, [pageId]: { ...(prev[pageId] || {}), [defId]: value } }));
    const { data: existing } = await supabase
      .from('kb_page_property_values')
      .select('id')
      .eq('page_id', pageId)
      .eq('property_def_id', defId)
      .maybeSingle();
    if (existing) {
      await supabase.from('kb_page_property_values').update({ value } as any).eq('id', (existing as any).id);
    } else {
      await supabase.from('kb_page_property_values').insert({
        tenant_id: requireTenantId(tenantId), page_id: pageId, property_def_id: defId, value,
      } as any);
    }
  };

  const addDef = async () => {
    if (!newName.trim()) return;
    await supabase.from('kb_page_property_defs').insert({
      tenant_id: requireTenantId(tenantId),
      database_page_id: databasePage.id,
      name: newName.trim(),
      type: newType,
      options: [],
      position: defs.length,
    } as any);
    setNewName(''); setAdding(false); load();
  };

  const removeDef = async (id: string) => {
    if (!confirm('Remover esta propriedade de todas as linhas?')) return;
    await supabase.from('kb_page_property_defs').delete().eq('id', id);
    load();
  };

  const renameDef = async (def: PropDef) => {
    const name = prompt('Novo nome', def.name);
    if (!name) return;
    await supabase.from('kb_page_property_defs').update({ name } as any).eq('id', def.id);
    load();
  };

  const renderCell = (def: PropDef, pageId: string) => {
    const v = values[pageId]?.[def.id];
    const opts: string[] = Array.isArray(def.options) ? def.options : [];

    switch (def.type) {
      case 'text':
      case 'url':
        return (
          <input
            className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
            defaultValue={v || ''} disabled={!canEdit}
            onBlur={(e) => e.target.value !== (v || '') && setValue(pageId, def.id, e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
            defaultValue={v ?? ''} disabled={!canEdit}
            onBlur={(e) => setValue(pageId, def.id, e.target.value === '' ? null : Number(e.target.value))}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
            defaultValue={v || ''} disabled={!canEdit}
            onChange={(e) => setValue(pageId, def.id, e.target.value)}
          />
        );
      case 'checkbox':
        return (
          <input type="checkbox" className="ml-2" checked={!!v} disabled={!canEdit}
            onChange={(e) => setValue(pageId, def.id, e.target.checked)} />
        );
      case 'select':
      case 'status':
        return (
          <select
            className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
            value={v || ''} disabled={!canEdit}
            onChange={async (e) => {
              if (e.target.value === '__new__') {
                const name = prompt('Nome da nova opção');
                if (name) {
                  const newOpts = [...opts, name];
                  await supabase.from('kb_page_property_defs').update({ options: newOpts } as any).eq('id', def.id);
                  await setValue(pageId, def.id, name);
                  load();
                }
              } else {
                setValue(pageId, def.id, e.target.value || null);
              }
            }}
          >
            <option value="">—</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
            {canEdit && <option value="__new__">+ Nova opção</option>}
          </select>
        );
      case 'multi_select':
        const selected: string[] = Array.isArray(v) ? v : [];
        return (
          <div className="flex flex-wrap gap-1 items-center px-1 py-0.5">
            {selected.map(s => (
              <span key={s} className="bg-primary/10 text-primary text-[11px] rounded px-2 py-0.5 flex items-center gap-1">
                {s}
                {canEdit && (
                  <button onClick={() => setValue(pageId, def.id, selected.filter(x => x !== s))}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger className="text-[11px] text-muted-foreground hover:text-foreground px-1">+</DropdownMenuTrigger>
                <DropdownMenuContent>
                  {opts.filter(o => !selected.includes(o)).map(o => (
                    <DropdownMenuItem key={o} onClick={() => setValue(pageId, def.id, [...selected, o])}>{o}</DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={async () => {
                    const name = prompt('Nome da opção');
                    if (name) {
                      const newOpts = [...opts, name];
                      await supabase.from('kb_page_property_defs').update({ options: newOpts } as any).eq('id', def.id);
                      await setValue(pageId, def.id, [...selected, name]);
                      load();
                    }
                  }}>+ Nova opção</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      default:
        return <span className="text-[12px] text-muted-foreground">—</span>;
    }
  };

  const propIcon = (t: string) => {
    const I = PROP_TYPES.find(p => p.type === t)?.icon || Type;
    return <I className="h-3.5 w-3.5" />;
  };

  return (
    <div className="mb-6">
      {/* View switcher */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          {VIEWS.map(v => {
            const Icon = v.icon;
            const active = view === v.key;
            return (
              <button key={v.key} onClick={() => onViewChange(v.key)}
                className={`flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>
                <Icon className="h-3.5 w-3.5" /> {v.label}
              </button>
            );
          })}
        </div>
        {canEdit && (
          <button onClick={onCreateRow} className="text-[12px] px-3 py-1 rounded bg-primary text-primary-foreground flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Nova linha
          </button>
        )}
      </div>

      {view === 'table' && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left font-medium text-muted-foreground px-3 py-2 border-r min-w-[220px]">
                  <div className="flex items-center gap-1.5"><FileTextIcon /> Nome</div>
                </th>
                {defs.map(def => (
                  <th key={def.id} className="text-left font-medium text-muted-foreground px-2 py-2 border-r min-w-[160px] group">
                    <div className="flex items-center gap-1.5">
                      {propIcon(def.type)}
                      <span className="flex-1 truncate">{def.name}</span>
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => renameDef(def)}>Renomear</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => removeDef(def.id)}>
                              <Trash2Icon /> Remover
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </th>
                ))}
                {canEdit && (
                  <th className="px-2 py-2 w-10">
                    {adding ? null : (
                      <button onClick={() => setAdding(true)} className="text-muted-foreground hover:text-foreground">
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </th>
                )}
              </tr>
              {adding && (
                <tr className="bg-muted/20">
                  <td colSpan={defs.length + 2} className="px-3 py-2">
                    <div className="flex gap-2 items-center">
                      <Input autoFocus placeholder="Nome da propriedade" value={newName}
                        onChange={e => setNewName(e.target.value)} className="h-8 text-[12px] flex-1 max-w-[260px]" />
                      <select value={newType} onChange={e => setNewType(e.target.value)}
                        className="h-8 text-[12px] border rounded px-2 bg-background">
                        {PROP_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </select>
                      <button onClick={addDef} className="text-[12px] px-3 h-8 rounded bg-primary text-primary-foreground">Adicionar</button>
                      <button onClick={() => { setAdding(false); setNewName(''); }} className="text-[12px] px-2 h-8 rounded hover:bg-muted">Cancelar</button>
                    </div>
                  </td>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={defs.length + 2} className="px-4 py-6 text-center text-muted-foreground text-[13px]">
                    Nenhuma linha. {canEdit && 'Clique em "Nova linha" para começar.'}
                  </td>
                </tr>
              ) : rows.map(row => (
                <tr key={row.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-1.5 border-r">
                    <button onClick={() => onSelectPage(row.id)} className="flex items-center gap-2 hover:underline text-left w-full">
                      <span className="w-4 text-center">{row.icon || '📄'}</span>
                      <span className="truncate">{row.title || 'Sem título'}</span>
                    </button>
                  </td>
                  {defs.map(def => (
                    <td key={def.id} className="px-1 py-0.5 border-r align-middle">
                      {renderCell(def, row.id)}
                    </td>
                  ))}
                  {canEdit && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'list' && (
        <div className="border rounded-lg divide-y">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted-foreground">Nenhuma linha.</div>
          ) : rows.map(row => (
            <div key={row.id} className="px-4 py-2 hover:bg-muted/20 flex items-center gap-3">
              <button onClick={() => onSelectPage(row.id)} className="flex items-center gap-2 hover:underline min-w-[200px]">
                <span>{row.icon || '📄'}</span>
                <span className="text-[13px]">{row.title || 'Sem título'}</span>
              </button>
              <div className="flex flex-wrap gap-3 text-[12px] text-muted-foreground">
                {defs.slice(0, 4).map(def => {
                  const v = values[row.id]?.[def.id];
                  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <span key={def.id} className="flex items-center gap-1">
                      <span className="opacity-60">{def.name}:</span>
                      <span className="text-foreground">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'gallery' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rows.length === 0 ? (
            <div className="col-span-full p-6 text-center text-[13px] text-muted-foreground border rounded-lg">Nenhuma linha.</div>
          ) : rows.map(row => (
            <button key={row.id} onClick={() => onSelectPage(row.id)}
              className="border rounded-lg p-4 text-left hover:bg-muted/20 transition-colors">
              <div className="text-3xl mb-2">{row.icon || '📄'}</div>
              <div className="text-[14px] font-medium mb-2 truncate">{row.title || 'Sem título'}</div>
              <div className="space-y-1">
                {defs.slice(0, 3).map(def => {
                  const v = values[row.id]?.[def.id];
                  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <div key={def.id} className="text-[11px] text-muted-foreground flex gap-1">
                      <span className="opacity-70">{def.name}:</span>
                      <span className="text-foreground truncate">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                    </div>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileTextIcon() {
  return <Type className="h-3.5 w-3.5" />;
}
function Trash2Icon() {
  return <X className="h-3.5 w-3.5 mr-1" />;
}

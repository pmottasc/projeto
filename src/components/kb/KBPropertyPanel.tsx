import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Plus, X, Type, Hash, Calendar, Tag, CheckSquare, Link as LinkIcon, ListChecks, User } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

interface PropDef {
  id: string;
  database_page_id: string;
  name: string;
  type: string;
  options: any;
  position: number;
}

interface PropVal {
  id?: string;
  property_def_id: string;
  value: any;
}

interface Props {
  pageId: string;
  databasePageId: string; // the parent database page
  canEdit: boolean;
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

export default function KBPropertyPanel({ pageId, databasePageId, canEdit }: Props) {
  const { tenantId } = useTenant();
  const [defs, setDefs] = useState<PropDef[]>([]);
  const [vals, setVals] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');

  const load = async () => {
    const [{ data: d }, { data: v }] = await Promise.all([
      supabase.from('kb_page_property_defs').select('*').eq('database_page_id', databasePageId).order('position'),
      supabase.from('kb_page_property_values').select('*').eq('page_id', pageId),
    ]);
    setDefs((d as any) || []);
    const map: Record<string, any> = {};
    (v || []).forEach((x: any) => { map[x.property_def_id] = x.value; });
    setVals(map);
  };

  useEffect(() => { load(); }, [pageId, databasePageId]);

  const setValue = async (defId: string, value: any) => {
    setVals(prev => ({ ...prev, [defId]: value }));
    const { data: existing } = await supabase.from('kb_page_property_values')
      .select('id').eq('page_id', pageId).eq('property_def_id', defId).maybeSingle();
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
      database_page_id: databasePageId,
      name: newName.trim(),
      type: newType,
      options: ['select', 'multi_select', 'status'].includes(newType) ? [] : [],
      position: defs.length,
    } as any);
    setNewName(''); setAdding(false); load();
  };

  const removeDef = async (id: string) => {
    if (!confirm('Remover esta propriedade de todas as páginas deste banco?')) return;
    await supabase.from('kb_page_property_defs').delete().eq('id', id);
    load();
  };

  const renderInput = (def: PropDef) => {
    const v = vals[def.id];
    const opts: string[] = Array.isArray(def.options) ? def.options : [];

    switch (def.type) {
      case 'text':
      case 'url':
        return <input className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
          defaultValue={v || ''} disabled={!canEdit}
          onBlur={(e) => e.target.value !== (v || '') && setValue(def.id, e.target.value)} />;
      case 'number':
        return <input type="number" className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
          defaultValue={v ?? ''} disabled={!canEdit}
          onBlur={(e) => setValue(def.id, e.target.value === '' ? null : Number(e.target.value))} />;
      case 'date':
        return <input type="date" className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
          defaultValue={v || ''} disabled={!canEdit}
          onChange={(e) => setValue(def.id, e.target.value)} />;
      case 'checkbox':
        return <input type="checkbox" className="ml-2" checked={!!v} disabled={!canEdit}
          onChange={(e) => setValue(def.id, e.target.checked)} />;
      case 'select':
      case 'status':
        return (
          <select className="bg-transparent text-[13px] outline-none w-full hover:bg-muted/40 rounded px-2 py-1"
            value={v || ''} disabled={!canEdit}
            onChange={async (e) => {
              if (e.target.value === '__new__') {
                const name = prompt('Nome da nova opção');
                if (name) {
                  const newOpts = [...opts, name];
                  await supabase.from('kb_page_property_defs').update({ options: newOpts } as any).eq('id', def.id);
                  await setValue(def.id, name);
                  load();
                }
              } else {
                setValue(def.id, e.target.value || null);
              }
            }}>
            <option value="">—</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
            {canEdit && <option value="__new__">+ Nova opção</option>}
          </select>
        );
      case 'multi_select':
        const selected: string[] = Array.isArray(v) ? v : [];
        return (
          <div className="flex flex-wrap gap-1 items-center">
            {selected.map(s => (
              <span key={s} className="bg-primary/10 text-primary text-[11px] rounded px-2 py-0.5 flex items-center gap-1">
                {s}
                {canEdit && <button onClick={() => setValue(def.id, selected.filter(x => x !== s))}><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger className="text-[11px] text-muted-foreground hover:text-foreground px-1">+</DropdownMenuTrigger>
                <DropdownMenuContent>
                  {opts.filter(o => !selected.includes(o)).map(o => (
                    <DropdownMenuItem key={o} onClick={() => setValue(def.id, [...selected, o])}>{o}</DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={async () => {
                    const name = prompt('Nome da opção');
                    if (name) {
                      const newOpts = [...opts, name];
                      await supabase.from('kb_page_property_defs').update({ options: newOpts } as any).eq('id', def.id);
                      await setValue(def.id, [...selected, name]);
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

  return (
    <div className="border-y bg-muted/10 px-2 py-2 my-3">
      <div className="space-y-1">
        {defs.map(def => {
          const Icon = PROP_TYPES.find(t => t.type === def.type)?.icon || Type;
          return (
            <div key={def.id} className="grid grid-cols-[180px_1fr_auto] gap-2 items-center group">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{def.name}</span>
              </div>
              {renderInput(def)}
              {canEdit && (
                <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                  onClick={() => removeDef(def.id)}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        adding ? (
          <div className="mt-2 flex gap-2 items-center">
            <Input autoFocus placeholder="Nome da propriedade" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-[12px] flex-1" />
            <select value={newType} onChange={e => setNewType(e.target.value)} className="h-8 text-[12px] border rounded px-2 bg-background">
              {PROP_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            <button onClick={addDef} className="text-[12px] px-3 h-8 rounded bg-primary text-primary-foreground">Adicionar</button>
            <button onClick={() => setAdding(false)} className="text-[12px] px-2 h-8 rounded hover:bg-muted">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-2 text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1">
            <Plus className="h-3 w-3" /> Adicionar propriedade
          </button>
        )
      )}
    </div>
  );
}

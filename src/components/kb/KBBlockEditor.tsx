import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  Quote, Minus, Code as CodeIcon, Image as ImageIcon, Lightbulb, Trash2, GripVertical, Video,
  Paperclip, FileText, Download,
} from 'lucide-react';

export interface Block {
  id: string;
  type: string;
  content: any;
  position: number;
}

interface Props {
  pageId: string;
  blocks: Block[];
  canEdit: boolean;
  onChange: () => void;
}

const BLOCK_TYPES = [
  { type: 'text', label: 'Texto', icon: Type },
  { type: 'h1', label: 'Título 1', icon: Heading1 },
  { type: 'h2', label: 'Título 2', icon: Heading2 },
  { type: 'h3', label: 'Título 3', icon: Heading3 },
  { type: 'bulleted', label: 'Lista', icon: List },
  { type: 'numbered', label: 'Lista numerada', icon: ListOrdered },
  { type: 'todo', label: 'Checklist', icon: CheckSquare },
  { type: 'quote', label: 'Citação', icon: Quote },
  { type: 'callout', label: 'Destaque', icon: Lightbulb },
  { type: 'code', label: 'Código', icon: CodeIcon },
  { type: 'divider', label: 'Divisor', icon: Minus },
  { type: 'image', label: 'Imagem', icon: ImageIcon },
  { type: 'video', label: 'Vídeo', icon: Video },
  { type: 'file', label: 'Arquivo / Anexo', icon: Paperclip },
];

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getImageUrl(path: string) {
  const { data } = supabase.storage.from('kb-media').getPublicUrl(path);
  return data.publicUrl;
}

export default function KBBlockEditor({ pageId, blocks, canEdit, onChange }: Props) {
  const { tenantId } = useTenant();
  const [slashMenu, setSlashMenu] = useState<{ blockId: string; q: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusId && refs.current[focusId]) {
      const el = refs.current[focusId]!;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges(); sel?.addRange(range);
      setFocusId(null);
    }
  }, [focusId, blocks.length]);

  const createBlock = async (afterPos: number, type = 'text', content: any = { text: '' }) => {
    const tid = requireTenantId(tenantId);
    // shift positions
    const toShift = blocks.filter(b => b.position > afterPos);
    for (const b of toShift) {
      await supabase.from('kb_blocks').update({ position: b.position + 1 } as any).eq('id', b.id);
    }
    const { data } = await supabase.from('kb_blocks').insert({
      tenant_id: tid, page_id: pageId, type, content, position: afterPos + 1,
    } as any).select().single();
    onChange();
    if (data) setFocusId((data as any).id);
  };

  const updateBlock = async (id: string, patch: Partial<Block>) => {
    await supabase.from('kb_blocks').update(patch as any).eq('id', id);
    onChange();
  };

  const deleteBlock = async (id: string) => {
    await supabase.from('kb_blocks').delete().eq('id', id);
    onChange();
  };

  const changeType = async (id: string, type: string) => {
    const b = blocks.find(x => x.id === id);
    if (!b) return;
    let content = b.content;
    if (type === 'todo' && content.checked === undefined) content = { ...content, checked: false };
    if (type === 'callout' && !content.emoji) content = { ...content, emoji: '💡' };
    if (type === 'code' && !content.language) content = { ...content, language: 'plaintext' };
    await supabase.from('kb_blocks').update({ type, content } as any).eq('id', id);
    setSlashMenu(null);
    onChange();
    setFocusId(id);
  };

  const handleKeyDown = async (e: KeyboardEvent<HTMLDivElement>, block: Block) => {
    if (e.key === 'Enter' && !e.shiftKey && !['code'].includes(block.type)) {
      e.preventDefault();
      const text = (e.currentTarget.textContent || '').trim();
      // persist current text first
      await updateBlock(block.id, { content: { ...block.content, text: e.currentTarget.textContent || '' } });
      // continue same list type, otherwise plain text
      const continueType = ['bulleted', 'numbered', 'todo'].includes(block.type) && text ? block.type : 'text';
      const newContent: any = { text: '' };
      if (continueType === 'todo') newContent.checked = false;
      await createBlock(block.position, continueType, newContent);
    } else if (e.key === 'Backspace' && (e.currentTarget.textContent || '') === '') {
      e.preventDefault();
      // focus previous block
      const idx = blocks.findIndex(b => b.id === block.id);
      const prev = blocks[idx - 1];
      await deleteBlock(block.id);
      if (prev) setFocusId(prev.id);
    } else if (e.key === '/' && !slashMenu) {
      setTimeout(() => setSlashMenu({ blockId: block.id, q: '' }), 0);
    } else if (e.key === 'Escape') {
      setSlashMenu(null);
    }
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>, block: Block) => {
    if (slashMenu?.blockId === block.id) {
      const txt = e.currentTarget.textContent || '';
      const slashIdx = txt.lastIndexOf('/');
      if (slashIdx === -1) setSlashMenu(null);
      else setSlashMenu({ blockId: block.id, q: txt.slice(slashIdx + 1).toLowerCase() });
    }
  };

  const handleBlur = async (e: React.FocusEvent<HTMLDivElement>, block: Block) => {
    const text = e.currentTarget.textContent || '';
    if (text !== (block.content.text || '')) {
      await updateBlock(block.id, { content: { ...block.content, text } });
    }
  };

  const onPickFromSlash = async (type: string) => {
    if (!slashMenu) return;
    const block = blocks.find(b => b.id === slashMenu.blockId);
    if (!block) return;
    // strip slash query from current content
    const el = refs.current[block.id];
    if (el) {
      const txt = el.textContent || '';
      const cleaned = txt.replace(/\/[^/]*$/, '');
      el.textContent = cleaned;
      await updateBlock(block.id, { content: { ...block.content, text: cleaned } });
    }
    if (type === 'image') {
      await createBlock(block.position, 'image', { path: '' });
    } else if (type === 'file') {
      await createBlock(block.position, 'file', { path: '' });
    } else if (type === 'divider') {
      await createBlock(block.position, 'divider', {});
    } else {
      await changeType(block.id, type);
    }
    setSlashMenu(null);
  };

  const handleImageUpload = async (block: Block, file: File) => {
    const tid = requireTenantId(tenantId);
    const path = `${tid}/${pageId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('kb-media').upload(path, file);
    if (!error) await updateBlock(block.id, { content: { path } });
  };

  const handleFileUpload = async (block: Block, file: File) => {
    const tid = requireTenantId(tenantId);
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${tid}/${pageId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('kb-media').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (!error) {
      await updateBlock(block.id, {
        content: { path, name: file.name, size: file.size, mime: file.type },
      });
    }
  };

  const filteredSlash = slashMenu
    ? BLOCK_TYPES.filter(t => t.label.toLowerCase().includes(slashMenu.q) || t.type.includes(slashMenu.q))
    : [];

  if (blocks.length === 0 && canEdit) {
    return (
      <div className="py-4">
        <div
          className="text-muted-foreground/60 text-[15px] cursor-text px-1"
          onClick={() => createBlock(-1, 'text', { text: '' })}
        >
          Clique aqui ou pressione + para começar a escrever...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 py-2">
      {blocks.map((block) => {
        const baseProps = {
          ref: (el: HTMLDivElement | null) => { refs.current[block.id] = el; },
          contentEditable: canEdit,
          suppressContentEditableWarning: true,
          onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleKeyDown(e, block),
          onInput: (e: React.FormEvent<HTMLDivElement>) => handleInput(e, block),
          onBlur: (e: React.FocusEvent<HTMLDivElement>) => handleBlur(e, block),
          className: 'outline-none focus:bg-muted/20 rounded px-1 py-0.5',
          'data-placeholder': "Digite '/' para comandos",
        };

        const text = block.content?.text ?? '';

        return (
          <div key={block.id} className="group relative flex items-start gap-1">
            {canEdit && (
              <div className="opacity-0 group-hover:opacity-60 flex items-center pt-1 shrink-0">
                <button
                  onClick={() => createBlock(block.position)}
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                  title="Adicionar bloco"
                >+</button>
                <button
                  onClick={() => deleteBlock(block.id)}
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                  title="Excluir"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="flex-1 min-w-0 relative">
              {/* Render per type */}
              {block.type === 'text' && (
                <div {...baseProps} className={`${baseProps.className} text-[15px] leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40`}>
                  {text}
                </div>
              )}
              {block.type === 'h1' && (
                <div {...baseProps} className={`${baseProps.className} text-3xl font-bold mt-4`}>{text}</div>
              )}
              {block.type === 'h2' && (
                <div {...baseProps} className={`${baseProps.className} text-2xl font-semibold mt-3`}>{text}</div>
              )}
              {block.type === 'h3' && (
                <div {...baseProps} className={`${baseProps.className} text-xl font-semibold mt-2`}>{text}</div>
              )}
              {block.type === 'bulleted' && (
                <div className="flex gap-2">
                  <span className="pt-1.5 text-muted-foreground">•</span>
                  <div {...baseProps} className={`${baseProps.className} flex-1 text-[15px]`}>{text}</div>
                </div>
              )}
              {block.type === 'numbered' && (
                <div className="flex gap-2">
                  <span className="pt-0.5 text-muted-foreground text-[14px]">{blocks.filter(b => b.type === 'numbered' && b.position <= block.position).length}.</span>
                  <div {...baseProps} className={`${baseProps.className} flex-1 text-[15px]`}>{text}</div>
                </div>
              )}
              {block.type === 'todo' && (
                <div className="flex gap-2 items-start">
                  <input
                    type="checkbox"
                    checked={!!block.content?.checked}
                    disabled={!canEdit}
                    onChange={(e) => updateBlock(block.id, { content: { ...block.content, checked: e.target.checked } })}
                    className="mt-1.5"
                  />
                  <div {...baseProps} className={`${baseProps.className} flex-1 text-[15px] ${block.content?.checked ? 'line-through text-muted-foreground' : ''}`}>{text}</div>
                </div>
              )}
              {block.type === 'quote' && (
                <div className="border-l-4 border-foreground/30 pl-3">
                  <div {...baseProps} className={`${baseProps.className} text-[15px] italic`}>{text}</div>
                </div>
              )}
              {block.type === 'callout' && (
                <div className="bg-muted/40 rounded-lg p-3 flex gap-3">
                  <span className="text-xl shrink-0">{block.content?.emoji || '💡'}</span>
                  <div {...baseProps} className={`${baseProps.className} flex-1 text-[14px]`}>{text}</div>
                </div>
              )}
              {block.type === 'code' && (
                <pre className="bg-muted/60 rounded-lg p-3 text-[13px] font-mono overflow-x-auto">
                  <div {...baseProps} className={`${baseProps.className} whitespace-pre-wrap`}>{text}</div>
                </pre>
              )}
              {block.type === 'divider' && (
                <hr className="my-3 border-border" />
              )}
              {block.type === 'image' && (
                <div>
                  {block.content?.path ? (
                    <div className="relative rounded-lg overflow-hidden border">
                      <img src={getImageUrl(block.content.path)} alt="" className="max-w-full max-h-[480px]" />
                    </div>
                  ) : canEdit ? (
                    <label className="block bg-muted/30 hover:bg-muted/50 border border-dashed rounded-lg p-6 cursor-pointer text-center text-[13px] text-muted-foreground">
                      <ImageIcon className="h-5 w-5 mx-auto mb-2 opacity-60" />
                      Clique para enviar imagem
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(block, e.target.files[0])} />
                    </label>
                  ) : null}
                </div>
              )}
              {block.type === 'video' && (
                <div>
                  {block.content?.url ? (
                    <div className="rounded-lg overflow-hidden border aspect-video">
                      {block.content.url.includes('youtu') ? (
                        <iframe src={block.content.url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')} className="w-full h-full" allowFullScreen />
                      ) : <video src={block.content.url} controls className="w-full h-full" />}
                    </div>
                  ) : canEdit ? (
                    <input
                      placeholder="Cole a URL do vídeo (YouTube ou direto)"
                      className="w-full bg-muted/30 border border-dashed rounded-lg p-3 text-[13px] outline-none focus:border-primary"
                      onBlur={(e) => e.target.value && updateBlock(block.id, { content: { url: e.target.value } })}
                    />
                  ) : null}
                </div>
              )}
              {block.type === 'file' && (
                <div>
                  {block.content?.path ? (
                    <a
                      href={getImageUrl(block.content.path)}
                      target="_blank"
                      rel="noreferrer"
                      download={block.content?.name}
                      className="flex items-center gap-3 border rounded-lg p-3 hover:bg-muted/40 transition-colors group/file"
                    >
                      <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium truncate">{block.content?.name || 'Arquivo'}</div>
                        <div className="text-[12px] text-muted-foreground">
                          {formatBytes(block.content?.size)}{block.content?.mime ? ` · ${block.content.mime}` : ''}
                        </div>
                      </div>
                      <Download className="h-4 w-4 text-muted-foreground opacity-0 group-hover/file:opacity-100" />
                    </a>
                  ) : canEdit ? (
                    <label className="block bg-muted/30 hover:bg-muted/50 border border-dashed rounded-lg p-6 cursor-pointer text-center text-[13px] text-muted-foreground">
                      <Paperclip className="h-5 w-5 mx-auto mb-2 opacity-60" />
                      Clique para anexar um arquivo (PDF, DOCX, XLSX, ZIP...)
                      <input type="file" className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileUpload(block, e.target.files[0])} />
                    </label>
                  ) : null}
                </div>
              )}


              {/* Slash menu */}
              {slashMenu?.blockId === block.id && filteredSlash.length > 0 && (
                <div className="absolute z-30 mt-1 w-64 bg-popover border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {filteredSlash.map(t => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.type}
                        onMouseDown={(e) => { e.preventDefault(); onPickFromSlash(t.type); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-[13px]"
                      >
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {canEdit && (
        <div
          className="text-muted-foreground/40 text-[14px] cursor-text px-1 pt-2 hover:text-muted-foreground"
          onClick={() => createBlock(blocks[blocks.length - 1]?.position ?? -1, 'text', { text: '' })}
        >
          + Adicionar bloco
        </div>
      )}
    </div>
  );
}

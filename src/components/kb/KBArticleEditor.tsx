import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant, requireTenantId } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, ImagePlus, Video, X } from 'lucide-react';

interface Category { id: string; name: string; }
interface StepData {
  id?: string; step_number: number; title: string; content: string;
  image_path: string | null; video_url: string | null;
  newImageFile?: File;
}

interface Props {
  articleId: string | null;
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
  onCategoriesChanged: () => void;
}

export default function KBArticleEditor({ articleId, categories, onSaved, onCancel, onCategoriesChanged }: Props) {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [steps, setSteps] = useState<StepData[]>([]);
  const [saving, setSaving] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!articleId) return;
    const load = async () => {
      const [{ data: art }, { data: stps }] = await Promise.all([
        supabase.from('kb_articles').select('*').eq('id', articleId).single(),
        supabase.from('kb_article_steps').select('*').eq('article_id', articleId).order('step_number'),
      ]);
      if (art) { const a = art as any; setTitle(a.title); setSummary(a.summary || ''); setCategoryId(a.category_id || ''); }
      if (stps) setSteps(stps.map((s: any) => ({ id: s.id, step_number: s.step_number, title: s.title, content: s.content, image_path: s.image_path, video_url: s.video_url })));
    };
    load();
  }, [articleId]);

  const addStep = () => setSteps(prev => [...prev, { step_number: prev.length + 1, title: '', content: '', image_path: null, video_url: null }]);
  const updateStep = (idx: number, field: keyof StepData, value: any) => setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })));

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    const { data } = await supabase.from('kb_categories').insert({ name: newCatName.trim(), tenant_id: requireTenantId(tenantId) } as any).select().single();
    if (data) { setCategoryId((data as any).id); setNewCatName(''); setShowNewCat(false); onCategoriesChanged(); }
  };

  const handleSave = async () => {
    if (!user || !title.trim()) return;
    setSaving(true);
    try {
      let artId = articleId;
      if (artId) {
        await supabase.from('kb_articles').update({ title: title.trim(), summary: summary.trim(), category_id: categoryId || null } as any).eq('id', artId);
      } else {
        const { data } = await supabase.from('kb_articles').insert({ title: title.trim(), summary: summary.trim(), category_id: categoryId || null, created_by: user.id, tenant_id: requireTenantId(tenantId) } as any).select().single();
        if (data) artId = (data as any).id;
      }
      if (!artId) { setSaving(false); return; }
      if (articleId) await supabase.from('kb_article_steps').delete().eq('article_id', artId);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        let imagePath = step.image_path;
        if (step.newImageFile) {
          const filePath = `${artId}/${Date.now()}-${step.newImageFile.name}`;
          const { error } = await supabase.storage.from('kb-media').upload(filePath, step.newImageFile);
          if (!error) imagePath = filePath;
        }
        await supabase.from('kb_article_steps').insert({ article_id: artId, step_number: i + 1, title: step.title, content: step.content, image_path: imagePath, video_url: step.video_url || null, tenant_id: requireTenantId(tenantId) } as any);
      }
      onSaved();
    } catch (e) { console.error('Error saving:', e); } finally { setSaving(false); }
  };

  const getImageUrl = (path: string) => { const { data } = supabase.storage.from('kb-media').getPublicUrl(path); return data.publicUrl; };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">{articleId ? 'Editar Artigo' : 'Novo Artigo'}</h1>
      </div>

      {/* Article Info */}
      <div className="bg-card rounded-xl border border-border/50 p-6 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-[13px]">Título *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título do artigo" className="h-9 text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[13px]">Resumo</Label>
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="Breve resumo..." rows={3} className="text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[13px]">Categoria</Label>
          {showNewCat ? (
            <div className="flex gap-2">
              <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Nome da categoria" className="flex-1 h-9 text-[13px]" />
              <Button size="sm" className="h-9 text-[12px]" onClick={handleCreateCategory}>Criar</Button>
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setShowNewCat(false)}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="flex-1 h-9 text-[13px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9 text-[12px]" onClick={() => setShowNewCat(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
            </div>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Etapas do Passo a Passo</h2>
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={addStep}><Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Etapa</Button>
        </div>

        {steps.length === 0 && (
          <div className="bg-card rounded-xl border border-dashed border-border py-10 text-center">
            <p className="text-[13px] text-muted-foreground">Clique em "Adicionar Etapa" para começar.</p>
          </div>
        )}

        {steps.map((step, idx) => (
          <div key={idx} className="bg-card rounded-xl border border-border/50 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-[12px] font-bold shrink-0">{idx + 1}</span>
              <Input value={step.title} onChange={e => updateStep(idx, 'title', e.target.value)} placeholder={`Título da etapa ${idx + 1}`} className="flex-1 h-9 text-[13px]" />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStep(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <Textarea value={step.content} onChange={e => updateStep(idx, 'content', e.target.value)} placeholder="Descreva esta etapa..." rows={3} className="text-[13px]" />
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label className="text-[11px] flex items-center gap-1 text-muted-foreground"><ImagePlus className="h-3 w-3" /> Imagem</Label>
                <input ref={el => { fileInputRefs.current[idx] = el; }} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) updateStep(idx, 'newImageFile', e.target.files[0]); e.target.value = ''; }} />
                {(step.newImageFile || step.image_path) ? (
                  <div className="relative rounded-lg overflow-hidden border border-border/50">
                    <img src={step.newImageFile ? URL.createObjectURL(step.newImageFile) : getImageUrl(step.image_path!)} alt="Preview" className="max-h-28 w-full object-contain bg-muted/20" />
                    <button onClick={() => { updateStep(idx, 'image_path', null); updateStep(idx, 'newImageFile', undefined); }} className="absolute top-1.5 right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full h-8 text-[11px]" onClick={() => fileInputRefs.current[idx]?.click()}><ImagePlus className="h-3.5 w-3.5 mr-1" /> Selecionar Imagem</Button>
                )}
              </div>
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label className="text-[11px] flex items-center gap-1 text-muted-foreground"><Video className="h-3 w-3" /> URL do Vídeo</Label>
                <Input value={step.video_url || ''} onChange={e => updateStep(idx, 'video_url', e.target.value)} placeholder="https://youtube.com/..." className="h-9 text-[12px]" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 justify-end sticky bottom-4">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} disabled={!title.trim() || saving}>{saving ? 'Salvando...' : articleId ? 'Salvar Alterações' : 'Criar Artigo'}</Button>
      </div>
    </div>
  );
}

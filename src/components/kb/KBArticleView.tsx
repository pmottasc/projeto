import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit, Layers } from 'lucide-react';

interface Category { id: string; name: string; }
interface Step {
  id: string; step_number: number; title: string; content: string;
  image_path: string | null; video_url: string | null;
}
interface Article {
  id: string; title: string; summary: string;
  category_id: string | null; created_at: string; updated_at: string;
}

interface Props {
  articleId: string;
  categories: Category[];
  onBack: () => void;
  onEdit?: () => void;
}

export default function KBArticleView({ articleId, categories, onBack, onEdit }: Props) {
  const [article, setArticle] = useState<Article | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    const load = async () => {
      const [{ data: art }, { data: stps }] = await Promise.all([
        supabase.from('kb_articles').select('*').eq('id', articleId).single(),
        supabase.from('kb_article_steps').select('*').eq('article_id', articleId).order('step_number'),
      ]);
      setArticle(art as Article | null);
      setSteps((stps as Step[]) || []);
    };
    load();
  }, [articleId]);

  if (!article) return null;

  const catName = categories.find(c => c.id === article.category_id)?.name || 'Sem categoria';

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from('kb-media').getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <span className="badge-status bg-primary/8 text-primary mb-2 inline-flex">
            <Layers className="h-3 w-3 mr-1" /> {catName}
          </span>
          <h1 className="text-xl font-semibold text-foreground tracking-tight leading-snug">{article.title}</h1>
        </div>
        {onEdit && (
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5 mr-1" /> Editar
          </Button>
        )}
      </div>

      {/* Summary */}
      {article.summary && (
        <div className="bg-primary/3 rounded-xl p-5 border border-primary/10">
          <p className="text-[13px] text-foreground leading-relaxed">{article.summary}</p>
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Passo a Passo</h2>
          {steps.map((step, idx) => (
            <div key={step.id} className="bg-card rounded-xl border border-border/50 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-muted/30 border-b border-border/50">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-[12px] font-bold shrink-0">
                  {idx + 1}
                </span>
                <h3 className="text-[13px] font-semibold text-foreground">{step.title || `Etapa ${idx + 1}`}</h3>
              </div>
              <div className="p-5 space-y-4">
                {step.content && (
                  <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{step.content}</p>
                )}
                {step.image_path && (
                  <div className="rounded-lg overflow-hidden border border-border/50">
                    <a href={getImageUrl(step.image_path)} target="_blank" rel="noopener noreferrer">
                      <img src={getImageUrl(step.image_path)} alt={step.title} className="w-full max-h-96 object-contain bg-muted/20" />
                    </a>
                  </div>
                )}
                {step.video_url && (
                  <div className="rounded-lg overflow-hidden border border-border/50 aspect-video">
                    {step.video_url.includes('youtube') || step.video_url.includes('youtu.be') ? (
                      <iframe src={step.video_url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')} className="w-full h-full" allowFullScreen title={step.title} />
                    ) : (
                      <video src={step.video_url} controls className="w-full h-full" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50 text-center pt-4">
        Atualizado em {new Date(article.updated_at).toLocaleDateString('pt-BR')}
      </p>
    </div>
  );
}

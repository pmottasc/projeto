import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card } from '@/components/ui/card';
import { Loader2, Briefcase, ExternalLink, LinkIcon } from 'lucide-react';

interface WorkLink {
  id: string;
  name: string;
  url: string;
  icon_url: string;
  description: string;
  position: number;
  active: boolean;
}

export default function Work() {
  const { tenantId } = useTenant();
  const [links, setLinks] = useState<WorkLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    void load();
  }, [tenantId]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from('work_links')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('position', { ascending: true });
    setLinks((data as WorkLink[]) || []);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Briefcase className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trabalho</h1>
          <p className="text-sm text-muted-foreground">Atalhos rápidos para os sistemas que você usa no dia a dia.</p>
        </div>
      </div>

      {links.length === 0 ? (
        <Card className="p-12 text-center">
          <LinkIcon className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium">Nenhum atalho disponível</p>
          <p className="text-xs text-muted-foreground mt-1">
            Solicite ao administrador da plataforma para configurar os links.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {links.map(link => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-card hover:bg-accent border border-border rounded-2xl p-5 flex flex-col items-center gap-3 transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40"
              title={link.description || link.url}
            >
              <ExternalLink className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {link.icon_url ? (
                  <img
                    src={link.icon_url}
                    alt={link.name}
                    className="h-full w-full object-contain p-2"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="h-full w-full bg-primary/10 text-primary font-bold text-xl items-center justify-center"
                  style={{ display: link.icon_url ? 'none' : 'flex' }}
                >
                  {link.name.charAt(0).toUpperCase()}
                </div>
              </div>
              <div className="text-center w-full">
                <p className="text-sm font-semibold truncate">{link.name}</p>
                {link.description && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{link.description}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Save, Palette, Trash2, RotateCcw } from 'lucide-react';

interface TenantOpt { id: string; name: string; slug: string; }
interface Props { tenants: TenantOpt[]; }

interface BrandingState {
  logo_url: string;
  logo_path: string;
  primary_hsl: string;
  accent_hsl: string;
  secondary_hsl: string;
  use_gradient: boolean;
  app_name: string;
}

const DEFAULT: BrandingState = {
  logo_url: '',
  logo_path: '',
  primary_hsl: '215 95% 56%',
  accent_hsl: '268 78% 58%',
  secondary_hsl: '328 88% 56%',
  use_gradient: true,
  app_name: '',
};

const PRESETS: Array<{ name: string; primary: string; accent: string; secondary: string }> = [
  { name: 'Hub (padrão)',  primary: '215 95% 56%', accent: '268 78% 58%', secondary: '328 88% 56%' },
  { name: 'Oceano',        primary: '200 95% 50%', accent: '190 80% 45%', secondary: '220 90% 55%' },
  { name: 'Floresta',      primary: '150 70% 40%', accent: '120 55% 45%', secondary: '170 65% 50%' },
  { name: 'Sunset',        primary: '20 90% 55%',  accent: '0 85% 60%',   secondary: '40 95% 55%' },
  { name: 'Roxo Royal',    primary: '270 80% 55%', accent: '290 75% 60%', secondary: '250 85% 60%' },
  { name: 'Grafite',       primary: '220 15% 35%', accent: '220 10% 50%', secondary: '215 20% 45%' },
];

// hex <-> hsl helpers (simples, suficientes p/ pickers)
function hexToHsl(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return '0 0% 0%';
  const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
function hslToHex(hsl: string): string {
  const [hStr, sStr, lStr] = hsl.split(' ');
  const h = parseFloat(hStr); const s = parseFloat(sStr) / 100; const l = parseFloat(lStr) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export default function TenantBrandingPanel({ tenants }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tenantId, setTenantId] = useState<string>(tenants[0]?.id || '');
  const [state, setState] = useState<BrandingState>(DEFAULT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (tenantId) void load(); }, [tenantId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('tenant_branding').select('*').eq('tenant_id', tenantId).maybeSingle();
    setState(data ? {
      logo_url: data.logo_url, logo_path: data.logo_path,
      primary_hsl: data.primary_hsl, accent_hsl: data.accent_hsl,
      secondary_hsl: data.secondary_hsl, use_gradient: data.use_gradient,
      app_name: data.app_name,
    } : DEFAULT);
    setLoading(false);
  }

  async function handleUpload(file: File) {
    if (!tenantId) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Arquivo grande', description: 'Máx. 2MB.', variant: 'destructive' }); return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${tenantId}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: true });
    if (error) {
      setUploading(false);
      toast({ title: 'Erro no upload', description: error.message, variant: 'destructive' }); return;
    }
    // Remove logo anterior, se houver
    if (state.logo_path && state.logo_path !== path) {
      await supabase.storage.from('tenant-logos').remove([state.logo_path]);
    }
    const { data: pub } = supabase.storage.from('tenant-logos').getPublicUrl(path);
    setState(s => ({ ...s, logo_url: pub.publicUrl, logo_path: path }));
    setUploading(false);
    toast({ title: 'Logo enviada' });
  }

  async function removeLogo() {
    if (state.logo_path) {
      await supabase.storage.from('tenant-logos').remove([state.logo_path]);
    }
    setState(s => ({ ...s, logo_url: '', logo_path: '' }));
  }

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    // Garante sessão válida (evita RLS bloquear por auth.uid() NULL após expiração)
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setSaving(false);
      toast({
        title: 'Sessão expirada',
        description: 'Faça login novamente como SuperAdmin para salvar o branding.',
        variant: 'destructive',
      });
      return;
    }

    // Confirma que o usuário ainda é platform admin
    const userId = sess.session.user.id;
    const { data: padmin } = await supabase
      .from('platform_admins').select('id').eq('user_id', userId).maybeSingle();
    if (!padmin) {
      setSaving(false);
      toast({
        title: 'Sem permissão',
        description: 'Apenas o SuperAdmin pode alterar o branding de um tenant.',
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase.from('tenant_branding').upsert({
      tenant_id: tenantId,
      ...state,
      updated_by: userId,
    }, { onConflict: 'tenant_id' });
    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return;
    }
    toast({ title: 'Branding salvo', description: 'O cliente verá o novo visual no próximo carregamento.' });
  }

  async function resetToDefault() {
    if (!confirm('Restaurar padrão (logo e cores)?')) return;
    if (state.logo_path) await supabase.storage.from('tenant-logos').remove([state.logo_path]);
    await supabase.from('tenant_branding').delete().eq('tenant_id', tenantId);
    setState(DEFAULT);
    toast({ title: 'Restaurado para o padrão' });
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Personalização visual do cliente</h3>
          </div>
          <div className="min-w-[260px]">
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="Selecione o tenant" /></SelectTrigger>
              <SelectContent>
                {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* COLUNA ESQUERDA: configuração */}
            <div className="space-y-5">
              {/* Logo */}
              <div className="space-y-2">
                <Label>Logo do cliente</Label>
                <div className="flex items-center gap-3">
                  <div
                    className="h-20 w-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80"
                    onClick={() => fileRef.current?.click()}
                  >
                    {state.logo_url
                      ? <img src={state.logo_url} alt="logo" className="max-h-full max-w-full object-contain" />
                      : <Upload className="h-6 w-6 text-muted-foreground" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                      Enviar logo
                    </Button>
                    {state.logo_url && (
                      <Button size="sm" variant="ghost" onClick={removeLogo}>
                        <Trash2 className="h-4 w-4 mr-1" /> Remover
                      </Button>
                    )}
                  </div>
                  <input
                    type="file" accept="image/*" ref={fileRef} className="hidden"
                    onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
                  />
                </div>
                <p className="text-xs text-muted-foreground">PNG/SVG transparente. Máx 2MB.</p>
              </div>

              {/* Nome do app */}
              <div className="space-y-2">
                <Label>Nome do app (opcional)</Label>
                <Input
                  value={state.app_name}
                  placeholder="Ex: Portal da Empresa X"
                  onChange={e => setState(s => ({ ...s, app_name: e.target.value }))}
                />
              </div>

              {/* Cores */}
              <div className="grid grid-cols-3 gap-3">
                <ColorField label="Primária" value={state.primary_hsl}
                  onChange={v => setState(s => ({ ...s, primary_hsl: v }))} />
                <ColorField label="Destaque" value={state.accent_hsl}
                  onChange={v => setState(s => ({ ...s, accent_hsl: v }))} />
                <ColorField label="Secundária" value={state.secondary_hsl}
                  onChange={v => setState(s => ({ ...s, secondary_hsl: v }))} />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm">Usar gradiente</Label>
                  <p className="text-xs text-muted-foreground">Aplica gradiente nas chamadas principais</p>
                </div>
                <Switch
                  checked={state.use_gradient}
                  onCheckedChange={v => setState(s => ({ ...s, use_gradient: v }))}
                />
              </div>

              {/* Presets */}
              <div className="space-y-2">
                <Label>Temas prontos</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PRESETS.map(p => (
                    <button
                      key={p.name}
                      onClick={() => setState(s => ({ ...s, primary_hsl: p.primary, accent_hsl: p.accent, secondary_hsl: p.secondary }))}
                      className="rounded-md border p-2 text-left hover:bg-muted transition"
                    >
                      <div className="flex gap-1 mb-1">
                        <span className="h-4 w-4 rounded" style={{ background: `hsl(${p.primary})` }} />
                        <span className="h-4 w-4 rounded" style={{ background: `hsl(${p.accent})` }} />
                        <span className="h-4 w-4 rounded" style={{ background: `hsl(${p.secondary})` }} />
                      </div>
                      <span className="text-xs">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* COLUNA DIREITA: preview */}
            <div className="space-y-3">
              <Label>Pré-visualização</Label>
              <div className="rounded-xl border overflow-hidden">
                <div
                  className="p-6 text-white"
                  style={{
                    background: state.use_gradient
                      ? `linear-gradient(135deg, hsl(${state.secondary_hsl}) 0%, hsl(${state.accent_hsl}) 50%, hsl(${state.primary_hsl}) 100%)`
                      : `hsl(${state.primary_hsl})`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {state.logo_url
                      ? <img src={state.logo_url} alt="" className="h-10 w-10 object-contain bg-white/10 rounded p-1" />
                      : <div className="h-10 w-10 rounded bg-white/20" />}
                    <div>
                      <p className="font-semibold">{state.app_name || 'Nome do App'}</p>
                      <p className="text-xs opacity-80">Topo do sistema</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-background space-y-3">
                  <div className="flex gap-2">
                    <Button style={{ background: `hsl(${state.primary_hsl})`, color: '#fff' }}>Botão primário</Button>
                    <Button variant="outline" style={{ borderColor: `hsl(${state.accent_hsl})`, color: `hsl(${state.accent_hsl})` }}>Destaque</Button>
                  </div>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 rounded text-xs text-white" style={{ background: `hsl(${state.primary_hsl})` }}>Primária</span>
                    <span className="px-2 py-1 rounded text-xs text-white" style={{ background: `hsl(${state.accent_hsl})` }}>Destaque</span>
                    <span className="px-2 py-1 rounded text-xs text-white" style={{ background: `hsl(${state.secondary_hsl})` }}>Secundária</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={resetToDefault} disabled={!tenantId}>
            <RotateCcw className="h-4 w-4 mr-1" /> Restaurar padrão
          </Button>
          <Button onClick={save} disabled={saving || !tenantId}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = hslToHex(value);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={e => onChange(hexToHsl(e.target.value))}
          className="h-10 w-12 rounded cursor-pointer border"
        />
        <Input value={value} onChange={e => onChange(e.target.value)} className="text-xs font-mono" />
      </div>
    </div>
  );
}

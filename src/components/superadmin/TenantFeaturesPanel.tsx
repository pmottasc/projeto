import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, ToggleLeft } from 'lucide-react';
import { FEATURES } from '@/lib/features';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

interface FeatureRow {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
}

interface Props {
  tenants: TenantRow[];
}

export default function TenantFeaturesPanel({ tenants }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(tenants[0]?.id || '');
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!tenants.length) return;
    if (!selectedTenantId || !tenants.find(t => t.id === selectedTenantId)) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId) return;
    void load();
  }, [selectedTenantId]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tenant_features')
      .select('tenant_id, feature_key, enabled')
      .eq('tenant_id', selectedTenantId);
    if (error) {
      toast({ title: 'Erro ao carregar recursos', description: error.message, variant: 'destructive' });
    }
    setRows((data as FeatureRow[]) || []);
    setLoading(false);
  };

  const isEnabled = (key: string): boolean => {
    const row = rows.find(r => r.feature_key === key);
    if (row) return row.enabled;
    const def = FEATURES.find(f => f.key === key);
    return def?.defaultEnabled ?? true;
  };

  const toggle = async (key: string, next: boolean) => {
    if (!selectedTenantId) return;
    setSaving(key);
    const { error } = await supabase
      .from('tenant_features')
      .upsert(
        { tenant_id: selectedTenantId, feature_key: key, enabled: next, updated_by: user?.id },
        { onConflict: 'tenant_id,feature_key' }
      );
    setSaving(null);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    setRows(prev => {
      const idx = prev.findIndex(r => r.feature_key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], enabled: next };
        return copy;
      }
      return [...prev, { tenant_id: selectedTenantId, feature_key: key, enabled: next }];
    });
    toast({ title: next ? 'Recurso liberado' : 'Recurso bloqueado' });
  };

  const tenant = tenants.find(t => t.id === selectedTenantId);

  return (
    <Card>
      <div className="p-5 border-b flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ToggleLeft className="h-5 w-5" /> Recursos por empresa
          </h2>
          <p className="text-xs text-muted-foreground">
            Libere ou bloqueie módulos individualmente. Bloqueado = some do menu para todos os usuários da empresa.
          </p>
        </div>
        <div className="min-w-[260px]">
          <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione uma empresa" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} <span className="text-muted-foreground ml-1">· {t.slug}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !tenant ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Selecione uma empresa.</p>
      ) : (
        <div className="divide-y">
          {FEATURES.map(f => {
            const Icon = f.icon;
            const enabled = isEnabled(f.key);
            return (
              <div key={f.key} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                <div
                  className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                    enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{f.key}</p>
                </div>
                <div className="flex items-center gap-2">
                  {saving === f.key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={enabled}
                    onCheckedChange={v => toggle(f.key, v)}
                    disabled={saving === f.key}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

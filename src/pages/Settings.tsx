import { useEffect, useState } from 'react';
import { Bot, Building2, FileText, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import ChatBotManager from '@/components/chatbot/ChatBotManager';
import DepartmentsPanel from '@/components/departments/DepartmentsPanel';
import DocumentsAutomationPanel from '@/components/documents/DocumentsAutomationPanel';
import { ConnectionPanel } from '@/pages/CentralAtendimento';

type ProviderKind = 'mock' | 'baileys' | 'meta_cloud' | 'evolution';
type ConnStatus = 'disconnected' | 'connecting' | 'qr_required' | 'qr_pending' | 'connected' | 'error';

interface ProviderConfig {
  id: string;
  provider: ProviderKind;
  status: ConnStatus;
  status_message: string;
  phone_number: string;
  display_name: string;
}

export default function Settings() {
  const { tenantId } = useTenant();
  const { isAdmin } = useAuth();
  const [provider, setProvider] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    if (!tenantId || !isAdmin) return;
    void (async () => {
      const { data } = await supabase
        .from('wa_provider_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (data) setProvider(data as ProviderConfig);
    })();
  }, [tenantId, isAdmin]);

  if (!isAdmin) {
    return (
      <Card className="p-12 text-center">
        <Settings2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="font-semibold mb-1">Acesso restrito</p>
        <p className="text-sm text-muted-foreground">Apenas administradores podem acessar as configurações.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-sm text-muted-foreground">Gerencie automações, conexão do WhatsApp e setores de atendimento.</p>
      </div>

      <Tabs defaultValue="chatbot" className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-4">
          <TabsTrigger value="chatbot"><Bot className="h-3.5 w-3.5 mr-1.5" /> ChatBot</TabsTrigger>
          <TabsTrigger value="documentos"><FileText className="h-3.5 w-3.5 mr-1.5" /> Documentos</TabsTrigger>
          <TabsTrigger value="conexao"><Settings2 className="h-3.5 w-3.5 mr-1.5" /> Conexões</TabsTrigger>
          <TabsTrigger value="setores"><Building2 className="h-3.5 w-3.5 mr-1.5" /> Setores</TabsTrigger>
        </TabsList>

        <TabsContent value="chatbot" className="mt-4">
          <ChatBotManager />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <DocumentsAutomationPanel />
        </TabsContent>

        <TabsContent value="conexao" className="mt-4">
          <ConnectionPanel provider={provider} tenantId={tenantId} onSaved={(p) => setProvider(p)} />
        </TabsContent>

        <TabsContent value="setores" className="mt-4">
          <DepartmentsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

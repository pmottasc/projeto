-- ========================
-- ENUMS
-- ========================
CREATE TYPE public.wa_provider_kind AS ENUM ('mock', 'baileys', 'meta_cloud');
CREATE TYPE public.wa_connection_status AS ENUM ('disconnected', 'connecting', 'qr_required', 'connected', 'error');
CREATE TYPE public.wa_conversation_status AS ENUM ('novo', 'em_atendimento', 'aguardando_cliente', 'finalizado');
CREATE TYPE public.wa_message_direction AS ENUM ('in', 'out');
CREATE TYPE public.wa_message_type AS ENUM ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'system');
CREATE TYPE public.wa_message_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');

-- ========================
-- wa_provider_config (1 linha por tenant)
-- ========================
CREATE TABLE public.wa_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  provider wa_provider_kind NOT NULL DEFAULT 'mock',
  phone_number text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  status wa_connection_status NOT NULL DEFAULT 'disconnected',
  status_message text NOT NULL DEFAULT '',
  bridge_url text NOT NULL DEFAULT '',
  webhook_secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  meta_phone_number_id text NOT NULL DEFAULT '',
  meta_access_token text NOT NULL DEFAULT '',
  qr_code text NOT NULL DEFAULT '',
  last_connected_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY wapc_admin_all ON public.wa_provider_config
  FOR ALL TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))
  WITH CHECK (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));

CREATE POLICY wapc_member_select ON public.wa_provider_config
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE TRIGGER trg_wapc_updated BEFORE UPDATE ON public.wa_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================
-- wa_contacts
-- ========================
CREATE TABLE public.wa_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  opt_in boolean NOT NULL DEFAULT true,
  opt_in_at timestamptz,
  blocked boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);
CREATE INDEX idx_wa_contacts_tenant ON public.wa_contacts(tenant_id);
CREATE INDEX idx_wa_contacts_phone ON public.wa_contacts(tenant_id, phone);
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY wac_member_select ON public.wa_contacts
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY wac_member_manage ON public.wa_contacts
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE TRIGGER trg_wac_updated BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================
-- wa_conversations
-- ========================
CREATE TABLE public.wa_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  status wa_conversation_status NOT NULL DEFAULT 'novo',
  assignee_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  internal_notes text NOT NULL DEFAULT '',
  ticket_id uuid,
  last_message_at timestamptz,
  last_message_preview text NOT NULL DEFAULT '',
  unread_count integer NOT NULL DEFAULT 0,
  bot_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_conv_tenant_status ON public.wa_conversations(tenant_id, status);
CREATE INDEX idx_wa_conv_assignee ON public.wa_conversations(tenant_id, assignee_id);
CREATE INDEX idx_wa_conv_contact ON public.wa_conversations(contact_id);
CREATE INDEX idx_wa_conv_last_msg ON public.wa_conversations(tenant_id, last_message_at DESC);
ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;

-- Atendentes veem conversas atribuídas a eles, sem responsável (livres) ou se forem admin do tenant.
CREATE POLICY waconv_select ON public.wa_conversations
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (
      user_is_tenant_admin(auth.uid(), tenant_id)
      OR assignee_id IS NULL
      OR assignee_id = auth.uid()
    )
  );

-- Membros do tenant podem criar conversa (necessário para "abrir nova conversa" pela UI).
CREATE POLICY waconv_insert ON public.wa_conversations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()));

-- Apenas responsável atual ou admin pode atualizar.
CREATE POLICY waconv_update ON public.wa_conversations
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (user_is_tenant_admin(auth.uid(), tenant_id) OR assignee_id = auth.uid() OR assignee_id IS NULL)
  )
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY waconv_admin_delete ON public.wa_conversations
  FOR DELETE TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_waconv_updated BEFORE UPDATE ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================
-- wa_messages
-- ========================
CREATE TABLE public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  direction wa_message_direction NOT NULL,
  type wa_message_type NOT NULL DEFAULT 'text',
  body text NOT NULL DEFAULT '',
  media_url text NOT NULL DEFAULT '',
  media_mime text NOT NULL DEFAULT '',
  status wa_message_status NOT NULL DEFAULT 'sent',
  external_id text NOT NULL DEFAULT '',
  sender_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_msg_conv ON public.wa_messages(conversation_id, created_at);
CREATE INDEX idx_wa_msg_tenant_created ON public.wa_messages(tenant_id, created_at DESC);
CREATE INDEX idx_wa_msg_external ON public.wa_messages(tenant_id, external_id) WHERE external_id <> '';
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: mesma regra das conversations (responsável, livre, ou admin)
CREATE POLICY wam_select ON public.wa_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.wa_conversations c
      WHERE c.id = wa_messages.conversation_id
        AND (user_is_tenant_admin(auth.uid(), c.tenant_id) OR c.assignee_id IS NULL OR c.assignee_id = auth.uid())
    )
  );

-- INSERT: pelo atendente atribuído ou admin (mensagens de saída).
-- Webhooks (entrada) usam service_role e bypassam RLS.
CREATE POLICY wam_insert ON public.wa_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND direction = 'out'
    AND sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.wa_conversations c
      WHERE c.id = wa_messages.conversation_id
        AND (user_is_tenant_admin(auth.uid(), c.tenant_id) OR c.assignee_id = auth.uid() OR c.assignee_id IS NULL)
    )
  );

CREATE POLICY wam_admin_delete ON public.wa_messages
  FOR DELETE TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id));

-- ========================
-- wa_webhook_events (auditoria)
-- ========================
CREATE TABLE public.wa_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider wa_provider_kind NOT NULL,
  event_type text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_evt_tenant_created ON public.wa_webhook_events(tenant_id, created_at DESC);
ALTER TABLE public.wa_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY waevt_admin_select ON public.wa_webhook_events
  FOR SELECT TO authenticated
  USING (user_is_tenant_admin(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));

-- INSERT/UPDATE/DELETE só via service_role (edge function de webhook)

-- ========================
-- Realtime
-- ========================
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
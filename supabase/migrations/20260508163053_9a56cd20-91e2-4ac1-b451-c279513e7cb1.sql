
-- Templates
CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  shortcut text NOT NULL,
  category text NOT NULL DEFAULT 'geral',
  content text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'any',
  visibility text NOT NULL DEFAULT 'tenant',
  active boolean NOT NULL DEFAULT true,
  allow_attachments boolean NOT NULL DEFAULT true,
  send_immediately_allowed boolean NOT NULL DEFAULT true,
  requires_review_before_send boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_shortcut_format CHECK (shortcut ~ '^/[a-z0-9_-]+$'),
  CONSTRAINT message_templates_channel_chk CHECK (channel IN ('any','whatsapp','email','chat','sms')),
  CONSTRAINT message_templates_visibility_chk CHECK (visibility IN ('private','tenant'))
);

CREATE UNIQUE INDEX message_templates_unique_shortcut_active
  ON public.message_templates(tenant_id, shortcut)
  WHERE active = true AND visibility = 'tenant';

CREATE INDEX message_templates_tenant_idx ON public.message_templates(tenant_id, active);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY mt_select ON public.message_templates FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (visibility = 'tenant' OR created_by = auth.uid())
  );

CREATE POLICY mt_insert ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND created_by = auth.uid()
    AND (visibility = 'private' OR user_is_tenant_admin(auth.uid(), tenant_id))
  );

CREATE POLICY mt_update ON public.message_templates FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (user_is_tenant_admin(auth.uid(), tenant_id) OR (visibility = 'private' AND created_by = auth.uid()))
  );

CREATE POLICY mt_delete ON public.message_templates FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (user_is_tenant_admin(auth.uid(), tenant_id) OR (visibility = 'private' AND created_by = auth.uid()))
  );

CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Template attachments
CREATE TABLE public.message_template_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.message_templates(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  original_file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mta_template_idx ON public.message_template_attachments(template_id);

ALTER TABLE public.message_template_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY mta_select ON public.message_template_attachments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));

CREATE POLICY mta_insert ON public.message_template_attachments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND uploaded_by = auth.uid()
  );

CREATE POLICY mta_delete ON public.message_template_attachments FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (user_is_tenant_admin(auth.uid(), tenant_id) OR uploaded_by = auth.uid())
  );

-- Scheduled messages
CREATE TABLE public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  contact_phone text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  ticket_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  subject text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  error_message text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_messages_status_chk CHECK (status IN ('pending','processing','sent','failed','canceled')),
  CONSTRAINT scheduled_messages_channel_chk CHECK (channel IN ('whatsapp','email','chat','sms'))
);

CREATE INDEX scheduled_messages_due_idx ON public.scheduled_messages(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX scheduled_messages_tenant_idx ON public.scheduled_messages(tenant_id, status);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY sm_select ON public.scheduled_messages FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (created_by = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id))
  );

CREATE POLICY sm_insert ON public.scheduled_messages FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND created_by = auth.uid()
  );

CREATE POLICY sm_update ON public.scheduled_messages FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (created_by = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id))
  );

CREATE POLICY sm_delete ON public.scheduled_messages FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (created_by = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id))
  );

CREATE TRIGGER scheduled_messages_updated_at
  BEFORE UPDATE ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validate scheduled_at on insert
CREATE OR REPLACE FUNCTION public.scheduled_messages_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.scheduled_at <= now() THEN
    RAISE EXCEPTION 'scheduled_at must be in the future';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scheduled_messages_validate_insert_trg
  BEFORE INSERT ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_messages_validate_insert();

-- Scheduled attachments
CREATE TABLE public.scheduled_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  scheduled_message_id uuid NOT NULL REFERENCES public.scheduled_messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  original_file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sma_sched_idx ON public.scheduled_message_attachments(scheduled_message_id);

ALTER TABLE public.scheduled_message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sma_select ON public.scheduled_message_attachments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));
CREATE POLICY sma_insert ON public.scheduled_message_attachments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND uploaded_by = auth.uid());
CREATE POLICY sma_delete ON public.scheduled_message_attachments FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids())
         AND (user_is_tenant_admin(auth.uid(), tenant_id) OR uploaded_by = auth.uid()));

-- Message logs
CREATE TABLE public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid,
  scheduled_message_id uuid,
  contact_phone text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  ticket_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent',
  provider_message_id text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  attachments_count integer NOT NULL DEFAULT 0,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_logs_status_chk CHECK (status IN ('sent','failed','queued'))
);

CREATE INDEX message_logs_tenant_idx ON public.message_logs(tenant_id, sent_at DESC);
CREATE INDEX message_logs_contact_idx ON public.message_logs(tenant_id, contact_phone, sent_at DESC);

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ml_select ON public.message_logs FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT current_user_tenant_ids())
    AND (sent_by = auth.uid() OR user_is_tenant_admin(auth.uid(), tenant_id))
  );

CREATE POLICY ml_insert ON public.message_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()));

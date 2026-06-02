export type MessageChannel = 'any' | 'whatsapp' | 'email' | 'chat' | 'sms';
export type ScheduledStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'canceled';
export type Visibility = 'private' | 'tenant';

export interface MessageTemplate {
  id: string;
  tenant_id: string;
  title: string;
  shortcut: string; // starts with /
  category: string;
  content: string;
  channel: MessageChannel;
  visibility: Visibility;
  active: boolean;
  allow_attachments: boolean;
  send_immediately_allowed: boolean;
  requires_review_before_send: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduledAttachment {
  url: string;
  name: string;
  mime: string;
  kind: 'image' | 'document' | 'video' | 'audio' | 'ptt';
  size?: number;
}

export interface ScheduledMessage {
  id: string;
  tenant_id: string;
  template_id: string | null;
  contact_phone: string;
  contact_name: string;
  contact_email: string;
  ticket_id: string | null;
  channel: Exclude<MessageChannel, 'any'>;
  subject: string;
  content: string;
  scheduled_at: string;
  status: ScheduledStatus;
  sent_at: string | null;
  failed_at: string | null;
  canceled_at: string | null;
  error_message: string;
  attempts: number;
  attachments: ScheduledAttachment[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VariableContext {
  contact?: { name?: string; phone?: string; email?: string };
  ticket?: { id?: string; protocol?: string; subject?: string };
  user?: { name?: string };
  link?: string;
}

import { supabase } from '@/integrations/supabase/client';
import type { MessageChannel } from './types';

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface SendInput {
  tenantId: string;
  channel: Exclude<MessageChannel, 'any'>;
  contactPhone?: string;
  contactEmail?: string;
  contactName?: string;
  content: string;
  templateId?: string | null;
  scheduledMessageId?: string | null;
  ticketId?: string | null;
  sentBy?: string;
}

/** Real-only sender. Returns clear "channel not configured" instead of fake success. */
export async function sendMessage(input: SendInput): Promise<SendResult> {
  let result: SendResult;
  if (input.channel === 'whatsapp') {
    result = await sendWhatsApp(input);
  } else if (input.channel === 'email') {
    result = { ok: false, error: 'Canal de e-mail ainda não configurado.' };
  } else if (input.channel === 'chat') {
    result = await sendInternalChat(input);
  } else if (input.channel === 'sms') {
    result = { ok: false, error: 'Canal de SMS ainda não configurado.' };
  } else {
    result = { ok: false, error: 'Canal desconhecido.' };
  }

  // Log every attempt
  await supabase.from('message_logs' as any).insert({
    tenant_id: input.tenantId,
    template_id: input.templateId || null,
    scheduled_message_id: input.scheduledMessageId || null,
    contact_phone: input.contactPhone || '',
    contact_name: input.contactName || '',
    ticket_id: input.ticketId || null,
    channel: input.channel,
    content: input.content,
    status: result.ok ? 'sent' : 'failed',
    provider_message_id: result.providerMessageId || '',
    error_message: result.error || '',
    sent_by: input.sentBy || null,
  } as any);

  return result;
}

async function sendWhatsApp(input: SendInput): Promise<SendResult> {
  if (!input.contactPhone) return { ok: false, error: 'Telefone obrigatório para WhatsApp.' };
  const { data, error } = await supabase.functions.invoke('wa-evolution', {
    body: { action: 'send', tenant_id: input.tenantId, phone: input.contactPhone, text: input.content },
  });
  if (error) return { ok: false, error: error.message || 'Falha ao enviar via WhatsApp' };
  if ((data as any)?.error) return { ok: false, error: (data as any).error };
  return { ok: true, providerMessageId: (data as any)?.externalId };
}

async function sendInternalChat(_input: SendInput): Promise<SendResult> {
  // Could create a chat_message — kept as informational for now.
  return { ok: false, error: 'Envio para Chat interno ainda não está integrado a esta tela.' };
}

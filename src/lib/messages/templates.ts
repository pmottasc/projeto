import { supabase } from '@/integrations/supabase/client';
import type { MessageTemplate, ScheduledMessage } from './types';
import { isValidShortcut } from './slash';

export async function listTemplates(tenantId: string): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates' as any)
    .select('*')
    .eq('tenant_id', tenantId)
    .order('shortcut', { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as MessageTemplate[];
}

export async function upsertTemplate(input: Partial<MessageTemplate> & { tenant_id: string; created_by: string; title: string; shortcut: string; content: string }): Promise<MessageTemplate> {
  if (!isValidShortcut(input.shortcut)) {
    throw new Error('Atalho inválido. Use o formato /palavra (somente minúsculas, números, hífen ou underline).');
  }
  const payload: any = {
    tenant_id: input.tenant_id,
    title: input.title,
    shortcut: input.shortcut.toLowerCase(),
    category: input.category || 'geral',
    content: input.content,
    channel: input.channel || 'any',
    visibility: input.visibility || 'tenant',
    active: input.active ?? true,
    allow_attachments: input.allow_attachments ?? true,
    send_immediately_allowed: input.send_immediately_allowed ?? true,
    requires_review_before_send: input.requires_review_before_send ?? false,
    created_by: input.created_by,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('message_templates' as any).update(payload).eq('id', input.id).select('*').single();
    if (error) throw error;
    return data as unknown as MessageTemplate;
  }
  const { data, error } = await supabase
    .from('message_templates' as any).insert(payload).select('*').single();
  if (error) throw error;
  return data as unknown as MessageTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('message_templates' as any).delete().eq('id', id);
  if (error) throw error;
}

export async function setTemplateActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('message_templates' as any).update({ active }).eq('id', id);
  if (error) throw error;
}

export async function duplicateTemplate(t: MessageTemplate, createdBy: string): Promise<MessageTemplate> {
  const newShortcut = `${t.shortcut}-copia`.slice(0, 40);
  return upsertTemplate({
    tenant_id: t.tenant_id, created_by: createdBy,
    title: `${t.title} (cópia)`, shortcut: newShortcut, content: t.content,
    category: t.category, channel: t.channel, visibility: 'private',
    active: false, allow_attachments: t.allow_attachments,
    send_immediately_allowed: t.send_immediately_allowed,
    requires_review_before_send: t.requires_review_before_send,
  });
}

// ---- Scheduled messages ----

export async function listScheduled(tenantId: string, status?: string): Promise<ScheduledMessage[]> {
  let q = supabase.from('scheduled_messages' as any).select('*').eq('tenant_id', tenantId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as ScheduledMessage[];
}

export async function createScheduled(input: Partial<ScheduledMessage> & { tenant_id: string; created_by: string; channel: ScheduledMessage['channel']; content: string; scheduled_at: string }): Promise<ScheduledMessage> {
  const when = new Date(input.scheduled_at);
  if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    throw new Error('Data/hora de envio deve ser no futuro.');
  }
  const payload: any = {
    tenant_id: input.tenant_id,
    template_id: input.template_id || null,
    contact_phone: input.contact_phone || '',
    contact_name: input.contact_name || '',
    contact_email: input.contact_email || '',
    ticket_id: input.ticket_id || null,
    channel: input.channel,
    subject: input.subject || '',
    content: input.content,
    scheduled_at: input.scheduled_at,
    status: 'pending',
    attachments: (input as any).attachments || [],
    created_by: input.created_by,
  };
  const { data, error } = await supabase.from('scheduled_messages' as any).insert(payload).select('*').single();
  if (error) throw error;
  return data as unknown as ScheduledMessage;
}

export async function cancelScheduled(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_messages' as any)
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending');
  if (error) throw error;
}

export async function updateScheduled(id: string, patch: Partial<ScheduledMessage>): Promise<void> {
  const { error } = await supabase.from('scheduled_messages' as any).update(patch as any).eq('id', id).eq('status', 'pending');
  if (error) throw error;
}

export async function retryScheduled(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_messages' as any)
    .update({ status: 'pending', error_message: '', failed_at: null, scheduled_at: new Date(Date.now() + 30_000).toISOString() })
    .eq('id', id).eq('status', 'failed');
  if (error) throw error;
}

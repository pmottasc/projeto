import type { MessageChannel } from './types';

export const MAX_FILE_SIZE_MB = 16; // WhatsApp upper bound
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ALLOWED_TYPES_BY_CHANNEL: Record<Exclude<MessageChannel, 'any'>, string[]> = {
  whatsapp: [
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
    'video/mp4', 'video/webm', 'video/quicktime',
  ],
  email: [
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain',
  ],
  chat: [
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'text/plain',
  ],
  sms: [], // SMS does not support attachments
};

export interface AttachmentValidationError {
  code: 'type' | 'size' | 'channel' | 'count';
  message: string;
}

export function validateAttachment(
  file: { name: string; type: string; size: number },
  channel: Exclude<MessageChannel, 'any'>,
): AttachmentValidationError | null {
  const allowed = ALLOWED_TYPES_BY_CHANNEL[channel];
  if (allowed.length === 0) {
    return { code: 'channel', message: `Este canal (${channel}) não permite envio de anexos.` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { code: 'size', message: `Arquivo "${file.name}" excede o tamanho máximo de ${MAX_FILE_SIZE_MB}MB.` };
  }
  if (!allowed.includes(file.type)) {
    if (file.type.startsWith('audio/') && !allowed.some(a => a.startsWith('audio/'))) {
      return { code: 'channel', message: `Este canal não permite envio de áudio.` };
    }
    if (file.type.startsWith('video/') && !allowed.some(a => a.startsWith('video/'))) {
      return { code: 'channel', message: `Este canal não permite envio de vídeo.` };
    }
    return { code: 'type', message: `Tipo de arquivo não permitido: ${file.type || file.name}.` };
  }
  return null;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'arquivo';
}

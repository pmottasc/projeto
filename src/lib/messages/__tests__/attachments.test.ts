import { describe, it, expect } from 'vitest';
import { validateAttachment, MAX_FILE_SIZE_BYTES } from '../attachments';

describe('attachments validation', () => {
  it('accepts pdf on whatsapp', () => {
    expect(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, 'whatsapp')).toBeNull();
  });
  it('rejects oversized files', () => {
    const r = validateAttachment({ name: 'big.mp4', type: 'video/mp4', size: MAX_FILE_SIZE_BYTES + 1 }, 'whatsapp');
    expect(r?.code).toBe('size');
  });
  it('blocks audio on email', () => {
    const r = validateAttachment({ name: 'a.mp3', type: 'audio/mpeg', size: 100 }, 'email');
    expect(r?.code).toBe('channel');
  });
  it('blocks all attachments on sms', () => {
    const r = validateAttachment({ name: 'a.png', type: 'image/png', size: 100 }, 'sms');
    expect(r?.code).toBe('channel');
  });
  it('rejects unknown mime type', () => {
    const r = validateAttachment({ name: 'a.exe', type: 'application/x-msdownload', size: 100 }, 'whatsapp');
    expect(r?.code).toBe('type');
  });
});

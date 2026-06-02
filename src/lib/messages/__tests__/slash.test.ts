import { describe, it, expect } from 'vitest';
import { detectSlashAtCursor, filterTemplates, isValidShortcut, replaceSlashToken } from '../slash';
import type { MessageTemplate } from '../types';

const tpl = (over: Partial<MessageTemplate>): MessageTemplate => ({
  id: 'x', tenant_id: 't', title: '', shortcut: '/x', category: 'geral', content: '',
  channel: 'any', visibility: 'tenant', active: true, allow_attachments: true,
  send_immediately_allowed: true, requires_review_before_send: false,
  created_by: 'u', created_at: '', updated_at: '', ...over,
});

describe('slash command', () => {
  it('validates shortcut format', () => {
    expect(isValidShortcut('/documentos')).toBe(true);
    expect(isValidShortcut('/cobranca_pix')).toBe(true);
    expect(isValidShortcut('documentos')).toBe(false);
    expect(isValidShortcut('/abc def')).toBe(false);
  });

  it('detects slash at cursor only when at line start or after space', () => {
    expect(detectSlashAtCursor('/doc', 4)).toEqual({ token: '/doc', start: 0 });
    expect(detectSlashAtCursor('hi /doc', 7)).toEqual({ token: '/doc', start: 3 });
    expect(detectSlashAtCursor('a/doc', 5)).toBeNull();
  });

  it('filters by prefix and ranks startsWith first', () => {
    const list = [tpl({ id: '1', shortcut: '/cobranca' }), tpl({ id: '2', shortcut: '/documentos' }), tpl({ id: '3', shortcut: '/dados' })];
    const r = filterTemplates(list, '/d');
    expect(r.map(t => t.id)).toEqual(['3', '2']);
  });

  it('replaces token in text', () => {
    const r = replaceSlashToken('hi /doc rest', 3, 4, 'OLÁ');
    expect(r.text).toBe('hi OLÁ rest');
    expect(r.cursor).toBe(6);
  });
});

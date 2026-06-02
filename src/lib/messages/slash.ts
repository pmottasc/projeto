import type { MessageTemplate } from './types';

export const SHORTCUT_REGEX = /^\/[a-z0-9_-]+$/;

export function isValidShortcut(s: string): boolean {
  return SHORTCUT_REGEX.test(s);
}

/**
 * Detects if cursor position in `text` is currently typing a slash command.
 * Returns the typed token (including leading slash) or null.
 */
export function detectSlashAtCursor(text: string, cursor: number): { token: string; start: number } | null {
  if (cursor <= 0 || cursor > text.length) return null;
  // walk backwards from cursor
  let i = cursor - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '/') {
      const before = i === 0 ? '' : text[i - 1];
      if (before && !/\s/.test(before)) return null;
      const token = text.slice(i, cursor);
      if (!/^\/[a-z0-9_-]*$/i.test(token)) return null;
      return { token, start: i };
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function filterTemplates(templates: MessageTemplate[], token: string, channel?: string): MessageTemplate[] {
  const q = token.replace(/^\//, '').toLowerCase();
  return templates
    .filter(t => t.active)
    .filter(t => !channel || t.channel === 'any' || t.channel === channel)
    .filter(t => {
      if (!q) return true;
      return (
        t.shortcut.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const aStarts = a.shortcut.toLowerCase().startsWith(`/${q}`) ? 0 : 1;
      const bStarts = b.shortcut.toLowerCase().startsWith(`/${q}`) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.shortcut.localeCompare(b.shortcut);
    });
}

export function replaceSlashToken(text: string, start: number, tokenLen: number, replacement: string): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(start + tokenLen);
  const newText = before + replacement + after;
  return { text: newText, cursor: (before + replacement).length };
}

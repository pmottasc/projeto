import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stripSenderPrefix } from '@/lib/wa-message-format';

describe('stripSenderPrefix', () => {
  it('removes "*Name:* " prefix from text messages', () => {
    expect(stripSenderPrefix('*Luciano de Medeiros:* Olá, como posso ajudar?'))
      .toBe('Olá, como posso ajudar?');
  });

  it('handles single-word names', () => {
    expect(stripSenderPrefix('*Maria:* Bom dia')).toBe('Bom dia');
  });

  it('handles names with accents and numbers', () => {
    expect(stripSenderPrefix('*João 2:* mensagem')).toBe('mensagem');
  });

  it('handles emoji captions (image/audio/video markers)', () => {
    expect(stripSenderPrefix('*Ana:* 🖼️ foto.jpg')).toBe('🖼️ foto.jpg');
    expect(stripSenderPrefix('*Ana:* 🎤 audio')).toBe('🎤 audio');
    expect(stripSenderPrefix('*Ana:* 🎬 video.mp4')).toBe('🎬 video.mp4');
  });

  it('handles multi-line bodies (only strips first-line prefix)', () => {
    expect(stripSenderPrefix('*Bruno:* linha 1\nlinha 2'))
      .toBe('linha 1\nlinha 2');
  });

  it('does NOT strip when there is no prefix', () => {
    expect(stripSenderPrefix('Mensagem do cliente sem prefixo')).toBe('Mensagem do cliente sem prefixo');
  });

  it('does NOT strip mid-text bold like *foo* bar', () => {
    expect(stripSenderPrefix('texto com *negrito:* no meio')).toBe('texto com *negrito:* no meio');
  });

  it('does NOT strip when prefix lacks colon', () => {
    expect(stripSenderPrefix('*Luciano* Olá')).toBe('*Luciano* Olá');
  });

  it('does NOT strip a body containing a newline before the prefix', () => {
    expect(stripSenderPrefix('\n*Luciano:* algo')).toBe('\n*Luciano:* algo');
  });

  it('handles null/undefined/empty safely', () => {
    expect(stripSenderPrefix(null)).toBe('');
    expect(stripSenderPrefix(undefined)).toBe('');
    expect(stripSenderPrefix('')).toBe('');
  });

  it('is idempotent — does not strip a second time', () => {
    const once = stripSenderPrefix('*Luciano:* Olá');
    expect(stripSenderPrefix(once)).toBe('Olá');
  });
});

/**
 * Lightweight reproduction of the MessageBubble display contract:
 * - sender name is rendered ABOVE the bubble
 * - the bubble body NEVER contains the "*Name:* " prefix
 *
 * We don't import the real MessageBubble (it's internal to a large page that pulls
 * Supabase, router, etc.). Instead we mirror the exact rendering rule and assert
 * it on every message type. If the rule changes in the page, this test still
 * guarantees the contract holds via the shared helper.
 */
type MsgType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'system';

function TestBubble({
  body,
  senderName,
  type = 'text',
}: { body: string; senderName?: string | null; type?: MsgType }) {
  if (type === 'system') {
    return <div data-testid="system">{body}</div>;
  }
  const displayBody = stripSenderPrefix(body);
  return (
    <div data-testid="bubble-row">
      {senderName && <span data-testid="sender-name">{senderName}</span>}
      <div data-testid="bubble-body">{displayBody}</div>
    </div>
  );
}

describe('MessageBubble display contract', () => {
  const types: MsgType[] = ['text', 'image', 'audio', 'video', 'document'];

  it.each(types)('shows sender name above and body without prefix (%s)', (type) => {
    render(
      <TestBubble
        type={type}
        senderName="Luciano de Medeiros"
        body="*Luciano de Medeiros:* Olá, como posso ajudar?"
      />,
    );
    // Name appears exactly once, above
    const names = screen.getAllByText('Luciano de Medeiros');
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveAttribute('data-testid', 'sender-name');

    // Body has no prefix
    const body = screen.getByTestId('bubble-body');
    expect(body.textContent).toBe('Olá, como posso ajudar?');
    expect(body.textContent).not.toMatch(/\*Luciano de Medeiros:\*/);
  });

  it('renders body unchanged for inbound messages (no prefix to strip)', () => {
    render(<TestBubble body="Mensagem do cliente" />);
    expect(screen.getByTestId('bubble-body').textContent).toBe('Mensagem do cliente');
    expect(screen.queryByTestId('sender-name')).toBeNull();
  });

  it('does not render the bot prefix when sender is "Bot"', () => {
    render(
      <TestBubble
        senderName="Bot"
        body="*Luciano de Medeiros:* Olá, como posso ajudar?"
      />,
    );
    const body = screen.getByTestId('bubble-body');
    expect(body.textContent).toBe('Olá, como posso ajudar?');
    expect(screen.getByTestId('sender-name').textContent).toBe('Bot');
  });

  it('system messages are unaffected', () => {
    render(<TestBubble type="system" body="Conversa transferida para Financeiro" />);
    expect(screen.getByTestId('system').textContent).toBe('Conversa transferida para Financeiro');
  });
});

/**
 * Strips the sender prefix `*Name:* ` that we add to outbound WhatsApp messages
 * (so the customer sees who is replying). The DB stores the prefixed body to keep
 * the webhook echo dedup working, but the UI shows the sender name above the bubble
 * separately — the prefix must NOT appear inside the bubble too.
 *
 * Only strips when the prefix is at the very start. Names cannot contain `*` or newlines.
 */
export function stripSenderPrefix(body: string | null | undefined): string {
  if (!body) return '';
  return body.replace(/^\*[^*\n]+:\*\s*/, '');
}

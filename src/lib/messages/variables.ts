import type { VariableContext } from './types';

const VAR_REGEX = /\{([a-z_]+)\}/gi;

export const KNOWN_VARIABLES = [
  'nome_contato', 'telefone_contato', 'email_contato',
  'protocolo', 'ticket_id', 'assunto_ticket',
  'nome_atendente', 'data_atual', 'hora_atual', 'link_atendimento',
] as const;

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function buildSubstitutions(ctx: VariableContext): Record<string, string> {
  const now = new Date();
  return {
    nome_contato: ctx.contact?.name || '',
    telefone_contato: ctx.contact?.phone || '',
    email_contato: ctx.contact?.email || '',
    protocolo: ctx.ticket?.protocol || '',
    ticket_id: ctx.ticket?.id || '',
    assunto_ticket: ctx.ticket?.subject || '',
    nome_atendente: ctx.user?.name || '',
    data_atual: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    hora_atual: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    link_atendimento: ctx.link || '',
  };
}

export function detectVariables(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(VAR_REGEX)) out.add(m[1].toLowerCase());
  return [...out];
}

export interface SubstituteResult {
  output: string;
  missing: string[];
}

export function substituteVariables(content: string, ctx: VariableContext): SubstituteResult {
  const subs = buildSubstitutions(ctx);
  const missing: string[] = [];
  const output = content.replace(VAR_REGEX, (full, raw) => {
    const key = String(raw).toLowerCase();
    const val = subs[key];
    if (val == null || val === '') {
      if (KNOWN_VARIABLES.includes(key as any)) missing.push(key);
      return full;
    }
    return val;
  });
  return { output, missing: Array.from(new Set(missing)) };
}

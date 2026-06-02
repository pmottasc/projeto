/**
 * Logger central. Em produção, silencia debug/info para reduzir ruído no console.
 * Erros e warnings sempre passam — facilita observabilidade futura (Sentry, etc).
 */
const isDev = import.meta.env.DEV;

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  info:  (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn:  (...args: unknown[]) => { console.warn(...args); },
  error: (...args: unknown[]) => { console.error(...args); },
};

# Hub HelpDesk

Sistema multi-tenant interno para chamados, ramais, base de conhecimento, cofre de senhas, conversor de documentos e PDF→OFX.

## Stack
- React 18 + Vite 5 + TypeScript
- Tailwind CSS + shadcn/ui (design tokens semânticos via `index.css`)
- React Query (cache de dados)
- React Router (BrowserRouter)
- Lovable Cloud (Supabase: Postgres + Auth + Storage + Edge Functions)

## Arquitetura

```
src/
  components/         # UI reutilizável (shadcn) + ErrorBoundary + AppLayout
  contexts/           # Auth, Tenant, Theme
  hooks/              # Hooks de domínio (presença, features, branding...)
  lib/                # Utilidades puras (logger, parsers, OFX, etc.)
  pages/              # Páginas lazy-loaded (code-splitting)
  integrations/       # Cliente Supabase (auto-gerado, NÃO editar)
supabase/
  functions/          # Edge Functions (Deno)
  migrations/         # Migrations versionadas
SECURITY.md           # Modelo de acesso, RLS, restrições admin
```

### Princípios
- **Code-splitting por página** (React.lazy + Suspense) — bundle inicial mínimo.
- **ErrorBoundary global** — evita tela branca em produção.
- **RLS em todas as tabelas** — segurança no banco, não no cliente.
- **Roles em tabela separada** (`user_roles`) + `has_role()` SECURITY DEFINER — sem recursão.
- **Validação Zod** nas Edge Functions — nunca confiar em payload do cliente.
- **Logger central** (`src/lib/logger.ts`) — silencia debug em produção.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Testes

```bash
npm test
```

Testes ficam ao lado do arquivo (`Component.test.tsx`) ou em `__tests__/`. Vitest + Testing Library + jsdom.

## Segurança

Veja [`SECURITY.md`](./SECURITY.md) para o modelo completo: multi-tenant, RLS, hardening de funções, política de senhas (HIBP), signups desabilitados.

## Convenções

- **Nunca** edite `src/integrations/supabase/{client,types}.ts` (auto-gerado).
- **Nunca** use cores literais (`text-white`); use tokens semânticos definidos em `index.css`.
- **Sempre** valide entradas com Zod antes de chamar API ou enviar para edge function.
- **Nunca** armazene roles em `profiles` — sempre em `user_roles` (evita escalonamento de privilégio).

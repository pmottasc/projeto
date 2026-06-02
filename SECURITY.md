# Segurança

## Modelo de acesso
- Multi-tenant: usuário ⇄ `tenant_members` (roles: `owner`, `admin`, `member`).
- Roles globais em `user_roles` (`admin`, `supervisor`, `user`).
- `platform_admins` para SuperAdmin.

## Garantias
- **RLS habilitado em 100% das tabelas `public.*`.** Toda leitura/escrita filtra por `current_user_tenant_ids()`.
- **Profiles escopados por tenant** — usuários só veem perfis de tenants que compartilham (corrigido em 2026-05).
- **Funções administrativas** (`mark_invoice_paid`, `generate_invoice_for_tenant`, `check_*`, `seed_*`, `handle_new_user`) **não são chamáveis via RPC** por clientes.
- **`search_path` fixo** em todas as funções `SECURITY DEFINER`.
- **Signup público desativado.** Usuários são criados via edge function `create-user` (service role + validação de admin) ou convites.
- **HIBP password check ativo** no Supabase Auth.
- **Storage**: buckets públicos servem objetos via URL pública mas a listagem em massa por anon foi bloqueada.

## Edge Functions
- Funções com `verify_jwt = false` (`bootstrap-superadmin`, `wa-*`) **devem** validar a origem em código (assinatura de webhook, header secreto ou validação manual de JWT).
- Nunca usar `service_role` no cliente. Apenas em edge functions.

## Boas práticas mantidas
- Sem SQL bruto em edge functions; sempre via cliente tipado.
- Validação Zod em entradas de funções públicas.
- Secrets armazenados no painel do Supabase (nunca no repo).

## Linter — warnings aceitos
1. Helpers RLS executáveis por `authenticated` — necessário para policies funcionarem.
2. `pg_net` instalado em `public` — migrar para schema dedicado é trabalho futuro.
3. Buckets públicos com policy SELECT por bucket — necessário para `<img>` e downloads diretos.

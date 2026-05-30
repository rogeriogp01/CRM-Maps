# Auth canônico (ROGA-89.3 / ROGA-60)

Este documento descreve **como o login real funciona** em produção e dev, e o
que precisa estar configurado no Dashboard Supabase para o fluxo ponta-a-ponta
não quebrar.

> Pré-requisito de runtime: ROGA-33 já entregou o helper
> `createSupabaseServerClient`, o middleware Next.js e a UI de login real.
> ROGA-59 migra os handlers `/api/*` para usarem esse helper. ROGA-60 (esta
> doc) cobre a configuração do provider.

## Arquitetura

```
Browser  ──(POST /login)──►  Next.js  ──(signInWithPassword)──►  Supabase Auth
   │                                                                  │
   │  ◄──(Set-Cookie: sb-access-token, sb-refresh-token)──────────────┘
   │
   ├──(GET /dashboard, cookies)──►  middleware.ts → refresh sessão
   │                                  │
   │                                  ▼
   │                                handler /api/* (createSupabaseServerClient)
   │                                  │
   │                                  ▼
   │                                Postgres (RLS via auth.uid())
```

Pontos-chave:

- **Cliente browser** (`@supabase/ssr`): `signInWithPassword` → seta cookies HTTP-only.
- **Middleware** (`src/middleware.ts`): roda em cada request, dá refresh no token, 401 em `/api/*` anônimo, redirect em HTML routes.
- **Handler /api/* canônico**: `createSupabaseServerClient()` lê o cookie do request e expõe `auth.uid()` ao Postgres.
- **Sistema** (worker de disparo, callbacks Baileys em `/api/whatsapp/connect`): mantém `supabaseAdmin` (service-role) — não é ação de usuário.

## Setup no Dashboard Supabase

> Faça uma vez por projeto (dev e prod separadamente).

### 1. Habilitar provider Email

`Authentication → Providers → Email`:

- ✅ **Enable Email provider**
- ☐ **Enable email signups** — DEIXE DESABILITADO para MVP (criação manual via Dashboard).
- ✅ **Confirm email** — recomendado em produção.
- ☐ Magic Link — opcional; documente se ativar.

### 2. URL Configuration

`Authentication → URL Configuration`:

- **Site URL**: `http://localhost:3000` (dev) ou `https://<dominio>` (prod).
- **Redirect URLs** (lista permitida):
  - `http://localhost:3000/api/auth/callback`
  - `https://<dominio>/api/auth/callback` (prod)

### 3. Email Templates

`Authentication → Email Templates`:

- Revisar **Confirm signup** e **Reset password**. O redirect padrão `{{ .ConfirmationURL }}` aponta para `/api/auth/callback` — não mexer.

### 4. Criar primeiro admin

`Authentication → Users → Add user`:

- **Email** + **Password** manualmente.
- (Opcional) `app_metadata`: `{ "workspace_id": "<uuid>" }` se já existir um workspace (ROGA-73/74). Caso contrário deixe vazio — o handler `/api/me` retorna `workspace_id: null` e o frontend lida com onboarding.

## Variáveis de ambiente

`.env.local` (dev) / Vercel project env (prod):

| Var | Origem | Onde usa | Obrigatória |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API | browser + server | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API | browser + server | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → **service_role** | worker / Baileys callbacks | sim |

⚠️ **Nunca** exporte `SUPABASE_SERVICE_ROLE_KEY` no client. Só é lida em código `server-only` (workers e rotas `/api/whatsapp/connect`).

## Smoke E2E

Roteiro mínimo para validar o setup acima sem subir um browser:

```bash
# 1. Login
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/callback \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<senha>"}'

# 2. Identidade (deve retornar 200 + user_id)
curl -i -b cookies.txt http://localhost:3000/api/me
# → { "user_id": "<uuid>", "email": "admin@example.com", "workspace_id": null }

# 3. Logout
curl -i -b cookies.txt -X POST http://localhost:3000/api/auth/signout
```

Critério de aceite (ROGA-92): `/api/me` retorna **200 com `user_id` válido**.
Quando ROGA-74 (multi-tenant) estiver de pé, o mesmo endpoint deve retornar
`workspace_id` populado a partir de `app_metadata`.

## Troubleshooting

- **401 em `/api/me` mesmo após login** — verifique se o cookie `sb-*` veio no response do POST `/api/auth/callback`. Geralmente é Site URL desalinhado no Dashboard.
- **`/api/crm/columns` retorna `{ columns: [] }` para um usuário logado** — handler já está migrado mas a policy RLS sobre `crm_columns` ainda não permite SELECT para `authenticated`. Aplique `database/009_rls_policies_mvp.sql` (ROGA-92.1).
- **`permission denied for table xxx` em POST** — mesma causa: falta INSERT policy.
- **Login funciona mas o usuário é deslogado em segundos** — `Site URL` ou `Redirect URLs` divergente entre Dashboard e middleware; cookie é setado em um domínio diferente do que o browser usa.

## Referências

- [ROGA-33](/ROGA/issues/ROGA-33) — middleware + login real
- [ROGA-59](/ROGA/issues/ROGA-59) — migração de handlers
- [ROGA-60](/ROGA/issues/ROGA-60) — esta doc
- [ROGA-92](/ROGA/issues/ROGA-92) — auth canônico (umbrella)

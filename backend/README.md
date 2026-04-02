# ScarabEV Backend (Block 1 + Block 2)

This workspace contains the hosted backend foundation for ScarabEV.

## Scope in this workspace
- Runtime skeleton for Cloudflare Worker API.
- Environment contract for `dev`, `staging`, `production`.
- Deploy pipeline shape (staging auto, production manual).
- Baseline observability (request logs + error capture).
- Block 2 authentication and security baseline:
  - Session-based admin auth (`owner`, optional `editor`).
  - CSRF checks on admin mutation routes.
  - Per-IP and per-user rate limiting for auth/admin routes.
  - Audit log writes for admin mutations.

## Workspace layout
- `src/index.ts`: Worker entrypoint and health route.
- `src/config/env.ts`: strict env contract and runtime validation.
- `src/observability/logger.ts`: structured logging and error capture.
- `src/types/schema.ts`: shared schema type scaffold.
- `migrations/`: SQL migration scaffolds.
- `migrations/0002_auth_security.sql`: auth, sessions, rate limits, and audit tables.
- `wrangler.toml`: local dev config.
- `wrangler.staging.toml`: staging deploy config.
- `wrangler.production.toml`: production deploy config.

## Local setup
1. Install dependencies:
   - `npm install`
2. Create local env file:
   - Copy `backend/.dev.vars.example` to `backend/.dev.vars`
3. Run local worker:
   - `npm run dev`

## Env variable contract
Required:
- `APP_NAME`: service name for logs/metadata.
- `APP_ENV`: `dev|staging|production`.
- `LOG_LEVEL`: `debug|info|warn|error`.
- `OBS_SAMPLE_RATE`: decimal in range `[0, 1]`.

Optional:
- `ERROR_SINK_DSN`: reserved for forwarding errors to external sink.
- `SESSION_COOKIE_NAME`: defaults to `scarabev_session`.
- `CSRF_COOKIE_NAME`: defaults to `scarabev_csrf`.
- `SESSION_TTL_SECONDS`: defaults to `28800`.
- `SESSION_ROTATION_SECONDS`: defaults to `1800`.
- `AUTH_RATE_LIMIT_WINDOW_SECONDS`: defaults to `300`.
- `AUTH_RATE_LIMIT_PER_IP`: defaults to `30`.
- `AUTH_RATE_LIMIT_PER_USER`: defaults to `15`.
- `ADMIN_RATE_LIMIT_WINDOW_SECONDS`: defaults to `60`.
- `ADMIN_RATE_LIMIT_PER_IP`: defaults to `240`.
- `ADMIN_RATE_LIMIT_PER_USER`: defaults to `120`.

## Secrets management strategy
- No secret values are committed to git.
- Local secrets live in `backend/.dev.vars` (gitignored).
- Staging/production secrets live in:
  - GitHub Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
  - Cloudflare Worker secrets (`wrangler secret put ... --env <env>`)
- D1 binding:
  - Bind D1 as `DB` in Wrangler config before using auth/admin routes.

## Block 2 routes
- `POST /admin/auth/login`
- `POST /admin/auth/logout`
- `GET /admin/auth/session`
- `GET /admin/healthz`
- `POST /admin/owner/ping` (owner-only mutation for role/audit/security baseline validation)
- `POST /admin/owner/change-password` (owner-only, requires `currentPassword` + `newPassword`, revokes current session)

## Admin credential note
- Password hashes use PBKDF2-SHA256.
- Keep `password_iterations` at `100000` or lower for Cloudflare Worker compatibility.

## Deploy workflow contract
- `main` branch push deploys `staging` automatically.
- `production` deploy runs only from manual `workflow_dispatch` with explicit confirmation.
- Production job uses GitHub `production` environment gate. Configure required reviewers in repo settings for approval.
- CI deploys staging/production via explicit Wrangler config files (`wrangler.staging.toml`, `wrangler.production.toml`) instead of `--env` mode.

# ScarabEV Backend (Blocks 1-8 in progress)

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
- Block 3 scarab lifecycle model:
  - `scarabs` + immutable `scarab_text_versions`.
  - Lifecycle transitions: `draft`, `active`, `retired`.
  - Deterministic active-list and token-input queries.
  - Retire/reactivate flow with league/season metadata references.
- Block 4 draft token generation engine:
  - Deterministic draft token generation from active scarab text.
  - Candidate scoring (`uniqueness`, `length`, `stability`) and collision detection.
  - Draft token set/report persistence with changed-token and retired-exclusion diagnostics.
- Block 5 publish and rollback:
  - Token set lifecycle states: `draft`, `published`, `archived`.
  - Publish gate checks: collision-free, full active coverage, and `poe_regex_profile` compatibility.
  - Rollback endpoint to re-activate a prior token set version.
  - Public read-only endpoint for frontend token consumption.
- Block 6 hosted admin UI:
  - Hosted admin page at `/admin/ui` for authenticated operations.
  - Scarab lifecycle controls, token draft/publish/rollback controls, token diff viewer.
  - Audit log search/view via authenticated API.
  - Owner/editor role split: publish + rollback remain owner-only.
- Block 7 migration and cutover tooling:
- Legacy inventory export + migration/parity scripts in `scripts/data-migration`.
  - Legacy token import path with publish-gate checks.
  - Public token payload includes `tokensByName` for frontend cutover.
- Block 8 reliability slice (staging-first):
  - Automated backup snapshots via scheduled trigger and owner-run endpoint.
  - Backup snapshot retention pruning.
  - Optional alert webhook hooks for auth failures, publish failures, and internal API errors.

## Workspace layout
- `src/index.ts`: Worker entrypoint and health route.
- `src/config/env.ts`: strict env contract and runtime validation.
- `src/observability/logger.ts`: structured logging and error capture.
- `src/types/schema.ts`: shared schema type scaffold.
- `migrations/`: SQL migration scaffolds.
- `migrations/0002_auth_security.sql`: auth, sessions, rate limits, and audit tables.
- `migrations/0003_scarab_lifecycle.sql`: scarab lifecycle + metadata + text history.
- `migrations/0004_token_drafts.sql`: draft token sets, entries, and reports.
- `migrations/0005_token_publish.sql`: published token sets and entries.
- `migrations/0006_ops_backups.sql`: backup snapshot persistence.
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
- `BACKUP_ENABLED`: defaults to `false`.
- `BACKUP_RETENTION_DAYS`: defaults to `14`.
- `BACKUP_REQUIRE_EXTERNAL`: defaults to `false` (set `true` to fail backup if no external target is configured).
- `BACKUP_OBJECT_PREFIX`: defaults to `snapshots`.
- `ALERT_WEBHOOK_URL`: optional webhook for operational alerts.

Optional binding:
- `BACKUP_R2`: R2 bucket binding for external backup objects. When bound, each snapshot is uploaded and its key is recorded as `externalKey`.

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

## Block 3 routes
- `GET /admin/scarabs` (supports `?status=draft,active,retired`)
- `POST /admin/scarabs` (create with initial text version)
- `GET /admin/scarabs/:scarabId`
- `PUT /admin/scarabs/:scarabId` (new immutable text version + metadata update)
- `GET /admin/scarabs/:scarabId/versions`
- `POST /admin/scarabs/:scarabId/retire`
- `POST /admin/scarabs/:scarabId/reactivate`
- `GET /admin/scarabs/token-inputs` (defaults to `active` scope only)

## Block 4 routes
- `POST /admin/token-drafts/generate` (create persisted deterministic draft token set + report)
- `GET /admin/token-drafts/latest` (latest persisted draft token set/report)

## Block 5 routes
- `POST /admin/token-sets/publish` (publish latest draft if gates pass)
- `POST /admin/token-sets/:tokenSetId/activate` (rollback/activate prior version)
- `GET /public/token-set/latest` (read-only latest published token set for frontend)

## Block 6 routes
- `GET /admin/ui` (hosted admin page)
- `GET /admin/token-sets` (list token sets for admin UI)
- `GET /admin/token-sets/:tokenSetId` (token set detail for diff viewer)
- `GET /admin/audit-logs` (audit search/view)

## Block 7 routes
- `POST /admin/token-sets/import-legacy` (owner-only legacy token import + publish)

## Block 8 routes
- `GET /admin/ops/backups` (owner-only backup snapshot list)
- `POST /admin/ops/backups/run` (owner-only manual backup snapshot)

## Admin credential note
- Password hashes use PBKDF2-SHA256.
- Keep `password_iterations` at `100000` or lower for Cloudflare Worker compatibility.

## Deploy workflow contract
- `main` branch push deploys `staging` automatically.
- `production` deploy runs only from manual `workflow_dispatch` with explicit confirmation.
- Production job uses GitHub `production` environment gate. Configure required reviewers in repo settings for approval.
- CI deploys staging/production via explicit Wrangler config files (`wrangler.staging.toml`, `wrangler.production.toml`) instead of `--env` mode.

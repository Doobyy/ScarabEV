# ScarabEV Backend (Block 1 Foundation)

This workspace contains the hosted backend foundation for ScarabEV.

## Scope in this block
- Runtime skeleton for Cloudflare Worker API.
- Environment contract for `dev`, `staging`, `production`.
- Deploy pipeline shape (staging auto, production manual).
- Baseline observability (request logs + error capture).

## Workspace layout
- `src/index.ts`: Worker entrypoint and health route.
- `src/config/env.ts`: strict env contract and runtime validation.
- `src/observability/logger.ts`: structured logging and error capture.
- `src/types/schema.ts`: shared schema type scaffold.
- `migrations/`: SQL migration scaffolds.
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

## Secrets management strategy
- No secret values are committed to git.
- Local secrets live in `backend/.dev.vars` (gitignored).
- Staging/production secrets live in:
  - GitHub Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
  - Cloudflare Worker secrets (`wrangler secret put ... --env <env>`)

## Deploy workflow contract
- `main` branch push deploys `staging` automatically.
- `production` deploy runs only from manual `workflow_dispatch` with explicit confirmation.
- Production job uses GitHub `production` environment gate. Configure required reviewers in repo settings for approval.
- CI deploys staging/production via explicit Wrangler config files (`wrangler.staging.toml`, `wrangler.production.toml`) instead of `--env` mode.

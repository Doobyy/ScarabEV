# ScarabEV Backend Runbook (Staging-First)

## Scope
- Runtime: Cloudflare Worker + D1.
- Environments: `dev`, `staging`, `production`.
- Policy: validate and rehearse in `staging` first, promote to production only after explicit approval.

## Incident Triage
1. Confirm symptom and blast radius.
2. Check Worker logs for `request.finish`, `backup.*`, and `alert.*` events.
3. Check `/healthz` and admin auth/session endpoints.
4. If issue is token behavior, inspect:
   - `/admin/token-sets`
   - `/admin/token-drafts/latest`
   - `/public/token-set/latest`
5. If issue is data mutation, query `/admin/audit-logs` with `pathContains` and `action`.

## Token Rollback
1. Login as `owner`.
2. Identify previous known-good set from `GET /admin/token-sets`.
3. Roll back:
   - `POST /admin/token-sets/:tokenSetId/activate`
4. Verify:
   - `GET /public/token-set/latest` returns expected `versionId`.
   - Frontend with `tokenSource=backend` uses expected mapping.

## Backup Operations
- Scheduled backup trigger is configured in staging (`0 */6 * * *`).
- Manual backup run:
  - `POST /admin/ops/backups/run` (owner-only).
- Backup status:
  - `GET /admin/ops/backups?limit=10` (owner-only).
- Retention:
  - snapshots older than `BACKUP_RETENTION_DAYS` are pruned during backup runs.
- External copy:
  - bind `BACKUP_R2` to upload snapshot JSON objects to R2.
  - set `BACKUP_REQUIRE_EXTERNAL=true` to fail backups if external upload is not available.

## Restore Drill (Cadence + Procedure)
- Cadence: weekly in staging (minimum), and before any production cutover.
- Procedure:
1. Run a fresh manual backup in staging.
2. Retrieve latest snapshot metadata from `GET /admin/ops/backups`.
3. Restore into a disposable D1 instance using snapshot payload tables.
4. Validate:
   - row counts for `scarabs`, `scarab_text_versions`, `token_sets`, `token_set_entries`.
   - published token parity using `npm run block7:parity` against restored target.
5. Record drill result (pass/fail, duration, issues) in project ops notes.

## Alerting
- Optional webhook via `ALERT_WEBHOOK_URL`.
- Alerts emitted for:
  - login failures (`auth_failure`)
  - token publish gate failures (`publish_failure`)
  - unhandled request errors (`api_error`)

## Dependency and Security Patch Routine
- Weekly routine:
1. `npm install` (refresh lock resolution if needed).
2. `npm run typecheck`
3. `npm test`
4. `npm run security:check`
5. `npm run deps:outdated`
6. Deploy and validate in staging.
- Promote to production only after explicit final approval and staging pass.

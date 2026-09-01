# AGENTS.md

## Purpose
Guide Codex work so edits stay minimal, correctly routed, and behavior-safe.

## Current Architecture Ownership

### Frontend (browser)
- `js/app.js`: UI shell, DOM rendering, events, tab flow, startup, global window bindings.
- `js/state.js`: mutable runtime state only.
- `js/config.js`: static constants/datasets/endpoints/order maps.
- `js/scarabEngine.js`: scarab EV/rate calculation logic.
- `js/regexEngine.js`: regex/token construction and transforms.
- `js/market.js`: market payload parsing/lookups/transforms.
- `js/tokenSource.js`: token source selection/fallback logic.
- `js/hashRouting.js`, `js/globalExpose.js`: routing/bootstrap glue.

### Backend API (Cloudflare Worker + TS app)
- `backend/src/index.ts`: API entry and composition.
- `backend/src/routes/*`: API route handlers (`scarab`, `auth`, `token`, admin ops).
- `backend/src/security/*`: auth/session/cookies/crypto/repository/roles.
- `backend/src/tokens/*`: token generation and regex profile helpers.
- `backend/src/admin/*`: admin UI composition.
- `backend/src/admin/view.ts`: admin markup.
- `backend/src/admin/styles.ts`: admin styles.
- `backend/src/admin/scripts/*.ts`: admin behavior by concern.
- `backend/src/admin/ui.ts`: admin composition only.

### Market Worker (data cache + history + backups)
- `workers/market-worker/worker.js`: market proxy/cache, EV/price history, snapshots, backup endpoints, cron.
- `workers/market-worker/wrangler*.toml`: worker env config.

## Routing Rules (Default)
- UI text/layout/interactions/tabs/wiring: start with `js/app.js` only.
- Shared runtime state shape/values: `js/state.js` (plus `js/app.js` only if wiring needed).
- Static lists/maps/endpoints/content constants: `js/config.js` only.
- EV/scarab math/calibration/thresholds: `js/scarabEngine.js` (wire call-sites only if required).
- Regex/token transform behavior: `js/regexEngine.js` (plus UI hookup only if required).
- Market response parse/lookup/normalization: `js/market.js` (plus `js/app.js` only for status/rendering effects).
- Token source/fallback behavior: `js/tokenSource.js`.
- Backend API behavior/security/admin/auth/token routes: `backend/src/**` only.
- Worker cache/cron/proxy/history/backup behavior: `workers/market-worker/worker.js` only unless API integration is explicitly required.

## Before Editing
- State planned file(s) and why.
- If touching more than 2 files, explain why first.
- If task crosses layers, prefer non-UI module changes first; add UI wiring only if required.

## Edit Policy
- Keep changes surgical and scoped; avoid unrelated files.
- Prefer one-file changes when possible.
- Do not rename files/functions/variables unless asked.
- Do not broad-refactor unless asked.
- Preserve behavior unless change is requested.
- Fix root cause first; if temporary mitigation is unavoidable, label it temporary and include follow-up plan.
- For iterative UI correction: remove/revert bad prior edit first; do not stack overrides on known-bad behavior.
- Do not collapse admin UI into one large file; keep modular split under `backend/src/admin`.

## app.js Boundary
Keep these in `js/app.js` unless restructuring is explicitly requested:
- DOM rendering
- event listeners/handlers
- tab switching
- slider behavior
- startup flow
- global window bindings

## Deployment Guardrails
- Repository/deployment context (source of truth for decisions):
  - This is a solo-maintained project, not primarily a multi-developer collaboration repo.
  - Frontend/static site deploy path is Git/GitHub-hosted.
  - Worker/backend runtime deploy path is Cloudflare Workers.
  - Treat this repo as frontend host plus source backup/history for maintaining live runtime systems.
- Future file/repo decisions should prioritize, in order:
  1. Files required to host the frontend.
  2. Files required to deploy/update Cloudflare workers.
  3. Files required to rebuild, maintain, or recover the live project.
  4. Clean repo hygiene (no secrets, local junk, caches, temp artifacts).
  5. Simplicity over team-process overhead.
- Anti-assumption note:
  - Do not automatically assume conventional multi-developer team repo practices are optimal here.
- Decision heuristic when uncertain:
  - "Does this materially help host the frontend, deploy/update the worker, or maintain/recover the live project?"
  - If not, default to local-only handling or ask before tracking.
- Never hardcode staging endpoints as unconditional production defaults.
- Environment-sensitive frontend endpoints must be production-safe by default and staging-aware only via explicit environment detection.
- Before production push handoff, scan for `backend-staging`; remaining hits must be docs/config/staging workflow references or environment-conditional logic (not unconditional runtime wiring).

## Data Source Guardrails (Must Follow)
- Do not add alternate market data sources (direct poe.ninja, mirrors, third-party relays) without explicit user approval.
- Market pricing flow is worker-first and worker-only unless user approves architecture change:
  - Worker fetches upstream on schedule.
  - Worker serves cached snapshots to clients.
  - Client follows worker staleness/expiry metadata.
- If client-side market path fails, fix worker/system path (availability, fetch, CORS, cache metadata, scheduling, stale handling); do not bypass with a new source.
- Any sourcing/caching/trust-model change requires user sign-off before implementation; present as option with tradeoffs first.

## Changelog Policy
- Add entries for major features, major reworks, or meaningful user-visible behavior changes.
- Do not add standalone entries for minor polish/refactors/maintenance.
- Fold minor fixes into the next feature release entry when relevant.
- If math/calibration/estimation changes, call it out prominently near top of release entry.


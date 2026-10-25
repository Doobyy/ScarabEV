# AGENTS.md

## Purpose
Guide Codex work so edits stay scoped, behavior-safe, and aligned with the project's intended architecture. This is a solo-maintained project; prioritize simplicity and maintainability over team-process overhead.

## Current Architecture Ownership

### Frontend (browser)
- `index.html` and page-specific HTML entry points: document structure and page metadata.
- `js/app.js`: currently the main application bootstrap and UI orchestration. It may be decomposed into shared initialization and page-specific entry points as required by the approved multi-page migration.
- `js/state.js`: shared mutable runtime state; avoid making every page initialize or depend on unrelated feature state unless required.
- `js/config.js`: static constants/datasets/endpoints/order maps/content.
- `js/scarabEngine.js`: scarab EV/rate calculation logic.
- `js/regexEngine.js`: regex/token construction and transforms.
- `js/market.js`: market payload parsing/lookups/transforms.
- `js/tokenSource.js`: token source selection/fallback logic.
- `js/hashRouting.js`, `js/globalExpose.js`, and related bootstrap code: existing routing/global compatibility glue. These may be changed or retired as the multi-page migration progresses.
- Feature modules include vendor, Atlas, Bulk, Logger, and Analysis code under `js/`; preserve their domain logic and reuse it where practical.

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
- `workers/market-worker/wrangler*.toml`: worker environment config.

## Multi-Page Frontend Direction (Approved Architectural Goal)
- The frontend is intentionally moving away from a single hash-routed application toward independently addressable HTML pages.
- Intended tool pages are Vendor (the root/landing page), Atlas, Bulk, Logger, Analysis, and FAQ.
- Prefer real page navigation and direct-loadable URLs over switching visible panes via URL hashes.
- Hosting is GitHub Pages under the `/ScarabEV/` project path. Design URLs and asset/navigation links to work under that base path; do not assume server-side rewrite rules are available. Directory-based pages are a candidate where they improve compatibility.
- Each page should load only the feature-specific JavaScript it needs, plus the shared dependencies required by that feature. Do not load and initialize every tool on every page merely to preserve the old single-page structure.
- Shared navigation, styling, common state/services, and genuinely shared startup behavior should remain reusable rather than copied across pages.
- Preserve existing feature behavior, data sourcing, authentication/token handling, market/league initialization, and global integrations where relevant to the page.
- Preserve legacy hash links or provide a sensible compatibility redirect/translation when practical, but do not let backward compatibility prevent the move to page-based navigation.
- Keep `hashRouting.js` and old compatibility code until dependency inspection confirms they can safely be removed.
- Page-specific titles, descriptions, canonical URLs, sitemap entries, and analytics visibility are part of the migration's later URL/metadata phase. AdSense integration is separate follow-up work, not a reason to bundle ads into the core refactor.

## Routing Rules (Default)
These are default ownership hints, not restrictions against the approved multi-page restructuring:
- UI text/layout/interactions: start with the relevant HTML page and its page/shared UI modules.
- Shared runtime state shape/values: `js/state.js`, with wiring in the relevant bootstrap only when needed.
- Static lists/maps/endpoints/content constants: `js/config.js`.
- EV/scarab math/calibration/thresholds: `js/scarabEngine.js` (wire call-sites only if required).
- Regex/token transform behavior: `js/regexEngine.js` (plus UI hookup only if required).
- Market response parsing/lookup/normalization: `js/market.js` (plus page-specific status/rendering effects if required).
- Token source/fallback behavior: `js/tokenSource.js`.
- Backend API behavior/security/admin/auth/token routes: `backend/src/**` only.
- Worker cache/cron/proxy/history/backup behavior: `workers/market-worker/worker.js` only unless API integration is explicitly required.
- The existing single-page ownership of tab switching, DOM assumptions, startup, and globals may be redesigned where necessary to make each page independently loadable.

## Before Editing
- Inspect the current repository files and actual imports, DOM assumptions, event handlers, globals, and startup order before changing architecture. Do not rely on stale local notes or assumed module boundaries.
- State the planned files and why before implementation.
- If touching more than 2 files, explain why the changes need to cross those boundaries.
- For multi-step architecture work, plan and implement in small phases with explicit scope and acceptance criteria.
- Stop and report the blocker if a phase requires substantially broader changes than its agreed scope; do not silently expand the task.

## Edit Policy
- Keep changes scoped to the requested outcome; avoid unrelated files and redesigns.
- Prefer the smallest coherent change, not necessarily the fewest changed lines or files. A clean shared/page-specific boundary is preferable to brittle hacks.
- Do not rename files/functions/variables unless needed for the requested architecture or explicitly asked.
- Broad refactoring is permitted when it is explicitly required for the multi-page migration. Keep it incremental, justified, and behavior-preserving; outside that approved scope, do not broad-refactor unless asked.
- Preserve existing behavior unless a change is requested. Reuse established calculations, feature modules, API contracts, and data sources rather than reimplementing them.
- Fix root causes first; if a temporary mitigation is unavoidable, label it temporary and include the follow-up plan.
- For iterative UI correction, remove/revert a known-bad prior edit before adding another fix; do not stack overrides on known-bad behavior.
- Do not collapse admin UI into one large file; keep the modular split under `backend/src/admin`.
- Do not add test benches, mock environments, or automated test infrastructure unless explicitly requested. The maintainer will manually test the frontend between migration phases. Do not spend implementation effort creating tests as a substitute for the agreed manual verification workflow.

## Git and Execution Guardrails
- Do not commit, push, switch branches, reset, revert, cherry-pick, merge, rewrite history, or create/delete branches unless the user explicitly authorizes that specific Git operation.
- Do not discard or overwrite user work. Inspect status/diffs before edits when working in a local checkout.
- Do not claim a page or feature was tested unless it was actually tested. If asked not to test, focus on implementation and report that manual verification remains outstanding.

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
- Anti-assumption note: do not automatically assume conventional multi-developer team repo practices are optimal here.
- Decision heuristic when uncertain: "Does this materially help host the frontend, deploy/update the worker, or maintain/recover the live project?" If not, default to local-only handling or ask before tracking.
- Never hardcode staging endpoints as unconditional production defaults.
- Environment-sensitive frontend endpoints must be production-safe by default and staging-aware only via explicit environment detection.
- Before production push handoff, scan for `backend-staging`; remaining hits must be docs/config/staging workflow references or environment-conditional logic, not unconditional runtime wiring.

## Data Source Guardrails (Must Follow)
- Do not add alternate market data sources (direct poe.ninja, mirrors, third-party relays) without explicit user approval.
- Market pricing flow is worker-first and worker-only unless the user approves an architecture change:
  - Worker fetches upstream on schedule.
  - Worker serves cached snapshots to clients.
  - Client follows worker staleness/expiry metadata.
- If the client-side market path fails, fix the worker/system path (availability, fetch, CORS, cache metadata, scheduling, stale handling); do not bypass it with a new source.
- Any sourcing/caching/trust-model change requires user sign-off before implementation; present options and tradeoffs first.

## Changelog Policy
- Add entries for major features, major reworks, or meaningful user-visible behavior changes.
- Do not add standalone entries for minor polish/refactors/maintenance.
- Fold minor fixes into the next feature release entry when relevant.
- If math/calibration/estimation changes, call it out prominently near the top of the release entry.

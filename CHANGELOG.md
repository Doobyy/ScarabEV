# Changelog

> Maintainer note: Keep this changelog feature-first. Add entries for major features, major reworks, or meaningful user-visible behavior changes. Avoid standalone entries for minor tune-ups/polish; fold those into the next feature release. When versioning a new release, keep the visible app version tag in `index.html` in sync with the latest `## [x.y]` heading here.

## [1.4] - 2026-03-26
### Focus: UX & Mobile Reliability
- Mobile layout stability: Improved tab navigation and phone-width layout behavior across the app.
- Deep-link routing: Strengthened hash routing support for direct links plus back/forward navigation.
- Readability polish: Upgraded FAQ/how-to contrast and tightened vendor/analysis table clarity.
- Reliability cleanup: Fixed bulk, toast, and loading-state edge cases that affected UX consistency.

---

## [1.3] - 2026-03-25
### Focus: EV Model Maturity
- Weighted EV mode: Added observed-frequency pricing using live market values.
- EV mode controls: Introduced harmonic and weighted mode switching in the main workflow.
- Estimation alignment: Matched estimator math to recycle-loop vendor behavior.
- Risk visibility: Added Weight Stability, Jackpot Reliance, and EV contribution insights.

---

## [1.2] - 2026-03-24
### Focus: Expansion Tabs
- Bulk analysis tools: Added Bulk Buy Analyzer with CSV and image-assisted parsing.
- Data analysis views: Added aggregate stats plus distribution and EV comparison panels.
- Atlas optimization: Added Atlas Optimizer with block/boost EV modeling controls.
- Trend visuals: Added EV trend history and vendor sparkline views.

---

## [1.1] - 2026-03-23
### Focus: Session Data Pipeline
- Session logging: Added before/after Wealthy Exile workflow for vendor sessions.
- Community sync: Added submission pipeline to Cloudflare D1.
- Quality controls: Added recycled, invalid, and low-signal session gating.
- Admin moderation: Added tools to review and manage submitted session data.

---

## [1.0] - 2026-03-22
### Focus: Platform Foundation
- Initial release: Shipped harmonic EV and auto-regex generation baseline.
- Theme support: Added dark and light mode switching.
- Live pricing: Integrated poe.ninja prices through the worker proxy path.
- Vendor controls: Added league, filter, and group interaction controls.

---

## [0.5] - 2026-03-15
### Focus: Closed Beta Tooling
- Logger stability: Reached first stable Session Logger and aggregate analysis loop.
- Data collection: Established community dataset submission flow.
- Data hygiene: Introduced recycle-detection and quality filtering.

---

## [0.4] - 2026-03-13
### Focus: Bulk Workflow Prototyping
- Bulk prototype: Launched the first Bulk Buy Analyzer workflow.
- Image extraction: Added screenshot-to-CSV parsing path.
- Name matching: Added fuzzy handling for OCR and noisy scarab names.

---

## [0.3] - 2026-03-11
### Focus: Backend Scaffolding
- Backend foundation: Added Cloudflare Worker and D1 service scaffolding.
- Admin panel: Shipped first moderation interface.
- Payload validation: Added initial rules for submitted session data.

---

## [0.2] - 2026-03-10
### Focus: Market-Linked Prototype
- Price ingestion: Established live market data pipeline.
- Regex tokens: Integrated token mapping for auto filter generation.
- Core interactions: Completed first league, sort, filter, and grouping model.

---

## [0.1] - 2026-03-09
### Focus: Alpha Baseline
- Manual pricing: Shipped first scarab price input workflow.
- EV baseline: Implemented harmonic EV foundation.
- Regex baseline: Added first auto-regex generation workflow.


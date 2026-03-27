# Changelog

> Maintainer note: Keep this changelog feature-first. Add entries for major features, major reworks, or meaningful user-visible behavior changes. Avoid standalone entries for minor tune-ups/polish; fold those into the next feature release. When versioning a new release, keep the visible app version tag in `index.html` in sync with the latest `## [x.y]` heading here.

## [1.4] - 2026-03-26
### Focus: UX & Mobile Reliability
- Mobile navigation + layout stabilization across tabs.
- Hash routing + tab deep-linking + back/forward support.
- FAQ/how-to readability and contrast upgrades.
- Vendor/analysis table readability + sorting consistency fixes.
- Bulk/Toast/Loading-state reliability fixes.

---

## [1.3] - 2026-03-25
### Focus: EV Model Maturity
- Weighted EV mode (observed frequencies × live prices).
- Harmonic vs weighted mode switching.
- Estimator math alignment to recycle-loop behavior.
- Contribution/risk insights (Weight Stability, Jackpot Reliance, EV contribution).

---

## [1.2] - 2026-03-24
### Focus: Expansion Tabs
- Bulk Buy Analyzer with CSV + image-assisted parsing.
- Data Analysis tab (aggregate stats, distribution/EV views).
- Atlas Optimizer tab with block/boost EV modeling.
- EV trend history and vendor sparklines.

---

## [1.1] - 2026-03-23
### Focus: Session Data Pipeline
- Session Logger (before/after Wealthy Exile workflow).
- Community submissions to Cloudflare D1.
- Session quality gating (recycled/invalid/low-signal detection).
- Admin moderation tools for session data.

---

## [1.0] - 2026-03-22
### Focus: Platform Foundation
- Initial ScarabEV release with harmonic EV + regex generation.
- Dark/light theme support.
- poe.ninja pricing integration (via worker proxy).
- Core vendor workflow controls (league/filter/group controls).

---

## [0.5] - 2026-03-15
### Focus: Closed Beta Tooling
- First stable Session Logger + aggregate analysis loop.
- Community dataset collection flow established.
- Early recycle-detection and data-quality filtering introduced.

---

## [0.4] - 2026-03-13
### Focus: Bulk Workflow Prototyping
- Bulk Buy Analyzer prototype launched.
- Screenshot-to-CSV parsing path introduced.
- Early fuzzy matching for OCR/noisy scarab names.

---

## [0.3] - 2026-03-11
### Focus: Backend Scaffolding
- Cloudflare Worker + D1 backend foundations added.
- First admin moderation interface shipped.
- Initial validation rules for incoming session payloads.

---

## [0.2] - 2026-03-10
### Focus: Market-Linked Prototype
- Live price ingestion pipeline established.
- Regex token integration added for auto filter generation.
- First league/sort/filter/group interaction model completed.

---

## [0.1] - 2026-03-09
### Focus: Alpha Baseline
- Manual scarab pricing workflow.
- Harmonic EV model baseline.
- First auto-regex generation workflow.


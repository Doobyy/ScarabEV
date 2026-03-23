# Changelog

All notable changes to ScarabEV will be documented here.

---

## [1.1] - 2026-03-23

### Added
- Changelog drawer — fetches CHANGELOG.md and renders in a side panel
- Hash routing — URL updates on tab switch, back/forward navigation works, direct tab links work
- Mobile hamburger drawer navigation

### Fixed
- Atlas tab showing inflated EV before community weights arrived
- FAQ content disappearing on browser refresh
- Several stuck loading states when navigating to tabs before data arrived
- Various mobile layout issues across vendor, analysis, and atlas tabs

---

## [1.0] - 2026-03-22

### Added
- Atlas Optimizer tab — block and boost atlas passive mechanics with live map drop EV recalculation
- EV Trend chart — 90-day daily harmonic EV history from Cloudflare KV cron
- Price sparklines in vendor table — 7-day per-scarab trend
- Vendor Profit Estimator with Wealthy Exile CSV import
- Per-scarab price override on the ninja tab
- Harmonic vs Weighted EV mode toggle

### Changed
- Vendor threshold is now an interactive slider with ROI color bar

---

## [0.5] - 2026-03-15

### Added
- Session Logger tab — before/after Wealthy Exile CSV diff to track vendor session profit
- Community session submission to shared Cloudflare D1 database
- Recycling detection — sessions with <15% vendor-target outputs are flagged and excluded
- Data Analysis tab — community aggregate stats, weight distribution chart, real vs ninja EV comparison
- Weighted EV mode using observed community drop frequencies × live ninja prices

---

## [0.4] - 2026-03-13

### Added
- Bulk Buy Analyzer tab — evaluate TFT bulk listings against live poe.ninja prices and EV threshold
- Gemini API image parsing — paste a screenshot, Gemini extracts Name,Qty CSV automatically
- Fuzzy scarab name matching — handles OCR errors, abbreviations, partial names

---

## [0.3] - 2026-03-11

### Added
- Community session API via Cloudflare Worker + D1 database
- Admin panel (admin.html) for viewing and deleting sessions
- Session quality validation — flags low sample, recycled, and invalid sessions

---

## [0.2] - 2026-03-10

### Added
- poe.ninja price integration via Cloudflare Worker proxy
- Auto-generated item filter regex using poe.re token map
- League selector, vendor/keep filter toggle, group collapse/expand
- Dark/light theme toggle

---

## [0.1] - 2026-03-09

### Added
- Initial release — manual scarab price entry, harmonic EV calculation, item filter regex generation

# Changelog

All notable changes to ScarabEV will be documented here.

> Maintainer note: The frontend reads the app version from the latest changelog heading (`## [x.y]`) and uses it for the visible version tag and update toast. Update the latest version here when releasing; do not rely on hardcoded version text elsewhere. For toast emphasis, prefer bullet format `Key phrase: supporting detail`. If calculation/math logic changes, place that bullet within the top 3 release bullets so it surfaces in the toast.

---

## [1.4] - 2026-03-26

### Changed
- Mobile layout polish: Reworked phone-width spacing and table fit across all tabs so key columns stay visible and readable without changing desktop layout.
- Table label/spacing cleanup: Standardized compact headers (`COST`, `CONTRIB`, `OUT/IN`, `INPUT`) and tightened column alignment in Session Logger and Data Analysis.
- FAQ + How-to refresh: Updated dark-mode FAQ and Session Logger how-to surfaces for clearer question/answer separation and more consistent highlight styling.
- UI crispness: Switched dense UI text rendering to a crisper font setup for better readability at current sizes.

### Fixed
- Bulk parse failure visibility: Partial image parses now show a clear red failure state so invalid data is not mistaken for valid results.
- Re-run feedback clarity: Running Analyze CSV again now visibly resets and rebuilds results so fresh processing is obvious.
- Contrast compliance pass: Updated light-mode accent/green and dark-mode text tiers for stronger WCAG-aligned readability.
- Navigation shortcut: Clicking the ScarabEV logo now returns directly to the Scarab Vendor tab.

---

## [1.3] - 2026-03-25

### Added
- Analysis insights: Added Weight Stability and Jackpot Reliance cards in Data Analysis to better explain output distribution and concentration risk.
- EV contribution view: Added per-scarab EV contribution column in Data Analysis so you can see which scarabs drive expected value most.

### Changed
- Estimator math alignment: Vendor and bulk estimates now use the calibrated recycle-loop vendor rate, so projected returns better match full vendor-until-keepers workflows.
- Market wording cleanup: Replaced repetitive source-heavy wording with clearer market-focused labels across analysis and helper text.
- Update toast readability: Improved changelog toast contrast and legibility for easier scanning in both light and dark themes.
- Changelog highlight formatting: Toast now auto-emphasizes key phrases from changelog bullets (recommended format: `Key phrase: detail`).

### Fixed
- Toast visual clipping: Fixed toast header/footer edge clipping so the card renders cleanly with rounded corners.
- Toast interaction timing: Hovering a version toast now pauses auto-dismiss and resumes on mouse leave.

---

## [1.2] - 2026-03-24

### Changed
- Regex generation now uses an inverse-regex fallback when needed, so a single regex can be used without managing split multi-regex setups.

### Fixed
- Scarab Vendor trend alignment: sparkline direction and trend % now use the same final price series, so the visual chart and numeric trend always match.
- Trend/history sorting consistency in the Scarab Vendor table, so ascending/descending behavior reflects the displayed trend values.
- Session Logger valuation edge case where received scarabs could be misclassified when vendor-marked logic overlapped, causing keeper value to be undercounted in some sessions.

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

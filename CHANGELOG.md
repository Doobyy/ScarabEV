# Changelog

All notable changes to ScarabEV will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1] - 2026-03-23

### Added
- Changelog drawer — fetches CHANGELOG.md and renders in a side panel without bloating index.html
- Notice box system — left-border highlight boxes (amber, blue, chaos variants) used throughout FAQ and pages
- FAQ entry for Atlas Optimizer with block/boost math explanation and weight data variance notice
- Hash routing — URL updates on tab switch, browser back/forward navigation works, direct tab links work
- Mobile hamburger drawer navigation sliding from the right
- Shortened mobile scarab names — last meaningful word (or two when ambiguous)
- Compact EV mode pill toggle for mobile (desktop keeps two-button toggle)

### Changed
- Analysis tab "ninja c/ea" header renamed to "Cost/ea" for consistency with vendor tab
- Analysis tab "Received" abbreviated to "Recv" on mobile only
- Fixed pool table: "Live share" → "Share", "EV contrib" → "Contrib", contrib values now muted
- FAQ rebuilt fresh on every tab switch — no stale render on browser refresh
- Atlas Optimizer shows "Waiting for community weight data…" instead of guessing with equal weights
- Divine rate reset on each price fetch — analysis tab no longer shows stale chaos/divine conversion

### Fixed
- Vendor tab cost/ea column zigzag — price-cell was inline-flex causing inconsistent right-alignment
- Analysis weight table header expanding beyond data rows on mobile
- Atlas tab showing inflated EV on first load before community weights arrived
- Analysis tab showing profit in chaos instead of divines when navigating before divine rate loaded
- FAQ content disappearing on browser refresh (initHashRouting fired before FAQ_SECTIONS was defined)
- Session Logger history not re-rendering when navigating back to tab
- Suggested badge truncating to "SUGGEST…" at normal desktop widths
- All tabs now retry data fetches if navigated to before data arrived — no stuck loading states

---

## [1.0] - 2026-03-22

### Added
- Atlas Optimizer tab — block and boost atlas passive mechanics with live map drop EV recalculation
- Block nodes: zero out mechanic weight and renormalize the drop pool
- Boost nodes: apply ×2 weight multiplier to selected mechanics
- Two-column layout — blockable mechanics on left, boostable on right
- Fixed pool section showing mechanics unaffected by atlas passives with their EV contribution
- Suggested badge highlights the single highest-impact untoggled option
- Per-mechanic expand rows showing per-scarab weight, price, and EV contribution
- Three hero stat cards: Map Drop EV, Baseline EV, EV Gain/Loss
- EV Trend chart — 90-day daily harmonic EV history from Cloudflare KV cron
- Price sparklines in vendor table — 7-day per-scarab trend with gradient fill and end dot
- Vendor Profit Estimator with Wealthy Exile CSV import
- Per-scarab price override on ninja tab — click any price to set custom qty:chaos ratio
- Harmonic vs Weighted EV mode toggle on vendor threshold slider

### Changed
- Vendor threshold replaced text input override with interactive slider
- Slider shows auto EV marker, ROI color bar, and live estimated ROI label

---

## [0.5] - 2026-01-20

### Added
- Session Logger tab — upload before/after Wealthy Exile CSV snapshots to track vendor session profit
- Regex auto-sync from Scarab Vendor tab into Session Logger field
- Session preview panel — vendor targets consumed, keeper outputs, input/output value, ROI
- Community session submission — clean sessions post to shared Cloudflare D1 database
- Recycling detection — sessions where less than 15% of outputs are vendor-target quality are flagged
- How-to guide for contributing clean single-pass session data
- Data Analysis tab — community aggregate stats, weight distribution chart, real vs ninja EV comparison
- Analysis weight table sortable by name, received count, weight %, and ninja price
- Weighted EV mode using observed community drop frequencies × live ninja prices

### Fixed
- Session history persists in localStorage across page refresh
- Output value excludes vendor targets that cycle back — keeper outputs only

---

## [0.4] - 2025-12-10

### Added
- Bulk Buy Analyzer tab — evaluate TFT bulk listings against live poe.ninja prices and EV threshold
- Gemini API image parsing — drop or paste a screenshot, Gemini extracts Name,Qty CSV automatically
- Gemini model fallback — auto-switches from Flash to Flash Lite on rate limit
- Fuzzy scarab name matching — 7-layer pipeline handles OCR errors, abbreviations, partial names
- Bulk name map — user-editable JSON override for persistent OCR corrections
- Per-listing summary: types matched, cost, expected return, net value, margin %
- Per-scarab breakdown with vendor/keep decision at current EV threshold

### Fixed
- Bulk name matching false positives on shared last tokens (Treasures, Wisps, Invasion, Stability)

---

## [0.3] - 2025-11-05

### Added
- Community session API via Cloudflare Worker + D1 database
- Admin panel (admin.html) — local only, view/delete sessions, aggregate stats
- Aggregate recompute on admin session delete
- Rate limiting on session submission (20 per IP per hour)
- Session quality validation — low sample, zero keepers, recycled sessions, outputs > inputs

---

## [0.2] - 2025-10-01

### Added
- poe.ninja price integration via Cloudflare Worker proxy (60s cache)
- Scarab Vendor tab — all prices loaded automatically, no manual entry needed
- League selector — Mirage, Standard, Mercenaries, Keepers
- Vendor/Keep/All filter toggle and sortable columns
- Group collapse/expand
- Auto-generated item filter regex using poe.re token map
- Regex character counter with over-limit warning and split regex for >250 char cases
- Dark/light theme toggle persisted in localStorage
- Divine orb rate for displaying large values in divines

### Changed
- Manual price entry tab retained as hidden fallback

### Fixed
- Regex using pre-validated unique substrings — no false matches on keep targets

---

## [0.1] - 2025-09-01

### Added
- Initial release
- Manual scarab price entry (qty:chaos per scarab type)
- Harmonic mean EV calculation — vendor threshold from all entered prices
- Item filter regex generation for PoE in-game loot filter
- All scarab types with CDN icons from web.poecdn.com
- In-game group ordering and alphabetical sort modes
- Vendor/Keep row highlighting based on EV threshold
- Prices auto-saved to browser localStorage
- Export/import prices as JSON
- Dark mode default

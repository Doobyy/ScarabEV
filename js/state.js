// Central mutable runtime state for ScarabEV frontend.
// Owns shared in-memory data and view state used across modules.
// Exposes a single state object for coordinated reads and writes.
// Keeps state shape in one place for predictable module wiring.
// Does not perform rendering, fetching, or calculations.

export const state = {
  // Price / threshold
  prices: {},         // manual prices {name -> {qty, cost}}
  evOverride: null,   // user-set EV override in chaos
  ninjaEvOverride: null,

  // Live market data
  ninjaPrices: {},    // {name -> chaosValue}
  ninjaImages: {},    // {name -> imageUrl} from worker items[]
  ninjaDivineRate: null, // divine orb chaos value
  ninjaLoaded: false,

  // Weight / calibration
  _observedWeights: null,  // { scarabName -> normalizedWeight } from aggregate
  _weightSessionCount: 0,
  _observedRateRaw: null,  // kept for admin/historical display only - not used in EV calc
  _calibratedRate: null,   // null = not ready; set once weights + ninja loaded
  _calibratedMean: null,   // sum(weight x ninjaPrice) / 3 - weighted EV threshold
  _calibratedP20: null,    // same as mean - kept for API compat
  _evMode: 'harmonic',     // 'harmonic' | 'weighted' - which auto EV to use for threshold

  // Price history / sparklines
  _priceHistory: {},       // { scarabName -> [{date, price}, ...] } - 7 days from worker
  _priceTotalChange: {},   // { scarabName -> totalChange % } - direct from API sparkline

  // UI view state
  collapsedM: new Set(),
  collapsedN: new Set(),
  manualView: 'all',
  sortMode: 'ingame',      // 'ingame' | 'alpha'
  ninjaView: 'all',
  currentTab: 'ninja',
  ninjaSort: null,         // null = grouped, 'cea-asc', 'cea-desc', etc.

  // Inline price override cell
  _activeOverrideCell: null,

  // EV history chart
  _evChartInstance: null,

  // Session logger
  _snap1: null,            // parsed CSV map: { scarabName -> qty }
  _snap2: null,
  _loggerRegexUserEdited: false,

  // Vendor profit estimator / CSV
  csvVendorQty: null,
  _csvRawItems: null,      // all scarabs from the last imported CSV (session-only)

  // Atlas optimizer
  _atlasBlocked: new Set(),
  _atlasBosted: new Set(),   // boosted groups (x2 weight multiplier)
  _atlasExpanded: new Set(),
  _atlasLeftoverOpen: true,

  // Bulk buy analyzer
  _bulkImageFile: null,
  _bulkSource: null,         // 'image' or 'csv'
  BULK_DEFAULT_NAME_MAP: {}, // shared defaults loaded from JSON file
  BULK_USER_NAME_MAP: {},    // user overrides stored in localStorage
  BULK_NAME_MAP: {},         // effective map = defaults merged with user overrides
};

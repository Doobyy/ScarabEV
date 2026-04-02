-- Block 1 foundation migration scaffold.
-- Core lifecycle tables are intentionally deferred to Block 3.
CREATE TABLE IF NOT EXISTS migration_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

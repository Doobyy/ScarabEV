-- Block 3 core data model: scarab lifecycle, metadata, and immutable text versions.

CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);

CREATE INDEX IF NOT EXISTS idx_seasons_league_id ON seasons(league_id);

CREATE TABLE IF NOT EXISTS scarabs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  league_id TEXT,
  season_id TEXT,
  retired_league_id TEXT,
  retired_season_id TEXT,
  retirement_note TEXT,
  retired_at TEXT,
  reactivated_at TEXT,
  current_text_version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (league_id) REFERENCES leagues(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (retired_league_id) REFERENCES leagues(id),
  FOREIGN KEY (retired_season_id) REFERENCES seasons(id),
  FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_scarabs_status_updated_at ON scarabs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_scarabs_league_id ON scarabs(league_id);
CREATE INDEX IF NOT EXISTS idx_scarabs_retired_league_id ON scarabs(retired_league_id);

CREATE TABLE IF NOT EXISTS scarab_text_versions (
  id TEXT PRIMARY KEY,
  scarab_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  modifiers_json TEXT NOT NULL,
  flavor_text TEXT,
  change_note TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scarab_id) REFERENCES scarabs(id),
  FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id),
  UNIQUE (scarab_id, version)
);

CREATE INDEX IF NOT EXISTS idx_scarab_text_versions_scarab_id_version
  ON scarab_text_versions(scarab_id, version DESC);

-- Block 4: draft token generation persistence.

CREATE TABLE IF NOT EXISTS draft_token_sets (
  id TEXT PRIMARY KEY,
  input_fingerprint TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_draft_token_sets_created_at
  ON draft_token_sets(created_at DESC);

CREATE TABLE IF NOT EXISTS draft_token_entries (
  id TEXT PRIMARY KEY,
  draft_set_id TEXT NOT NULL,
  scarab_id TEXT NOT NULL,
  token TEXT NOT NULL,
  candidate_token TEXT NOT NULL,
  uniqueness_score REAL NOT NULL,
  length_score REAL NOT NULL,
  stability_score REAL NOT NULL,
  total_score REAL NOT NULL,
  candidate_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_set_id) REFERENCES draft_token_sets(id),
  FOREIGN KEY (scarab_id) REFERENCES scarabs(id),
  UNIQUE (draft_set_id, scarab_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_token_entries_set_id ON draft_token_entries(draft_set_id);
CREATE INDEX IF NOT EXISTS idx_draft_token_entries_scarab_id ON draft_token_entries(scarab_id);

CREATE TABLE IF NOT EXISTS draft_token_reports (
  draft_set_id TEXT PRIMARY KEY,
  collisions_json TEXT NOT NULL,
  low_confidence_json TEXT NOT NULL,
  changed_tokens_json TEXT NOT NULL,
  excluded_retired_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_set_id) REFERENCES draft_token_sets(id)
);

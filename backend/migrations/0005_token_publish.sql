-- Block 5: publish/rollback token set lifecycle.

CREATE TABLE IF NOT EXISTS token_sets (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'archived')),
  source_draft_set_id TEXT NOT NULL,
  regex_profile_name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (source_draft_set_id) REFERENCES draft_token_sets(id),
  FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_token_sets_state_published_at
  ON token_sets(state, published_at DESC);

CREATE TABLE IF NOT EXISTS token_set_entries (
  id TEXT PRIMARY KEY,
  token_set_id TEXT NOT NULL,
  scarab_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (token_set_id) REFERENCES token_sets(id),
  FOREIGN KEY (scarab_id) REFERENCES scarabs(id),
  UNIQUE (token_set_id, scarab_id)
);

CREATE INDEX IF NOT EXISTS idx_token_set_entries_set_id ON token_set_entries(token_set_id);

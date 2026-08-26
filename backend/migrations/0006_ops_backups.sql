-- Block 8: operational backup snapshots (staging-first reliability slice).

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  initiated_by_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (initiated_by_user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created_at
  ON backup_snapshots(created_at DESC);

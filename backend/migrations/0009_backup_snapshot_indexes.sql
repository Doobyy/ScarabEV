-- Block 9: optimize latest backup snapshot lookups.
-- Match the query ordering exactly and allow status-filtered latest-success lookups
-- to avoid scanning the full backup snapshot history.

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created_at_id
  ON backup_snapshots(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_status_created_at_id
  ON backup_snapshots(status, created_at DESC, id DESC);

DROP INDEX IF EXISTS idx_backup_snapshots_created_at;

-- Block 8: backup snapshot external storage metadata.

ALTER TABLE backup_snapshots ADD COLUMN external_key TEXT;

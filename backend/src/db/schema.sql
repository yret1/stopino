CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    last_heartbeat INTEGER NOT NULL,
    protection_active INTEGER NOT NULL,
    alerted INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS buddies (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  contact TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_stale
  ON devices (last_heartbeat, alerted);
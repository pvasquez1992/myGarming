CREATE TABLE sync_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE sync_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL CHECK (state IN ('ok', 'failed', 'reauth_required')),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  processed_count INTEGER NOT NULL CHECK (processed_count >= 0)
);

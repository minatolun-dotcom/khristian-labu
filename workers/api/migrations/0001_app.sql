-- Khristian Labu staging API tables.
--
-- Better Auth owns user/session/account/verification and its plugin tables.
-- This migration owns only the approved-change diff layer.

CREATE TABLE IF NOT EXISTS publish_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO publish_state (id, version, updated_at)
VALUES (1, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS published_edits (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('song', 'struct', 'chord')),
  payload      TEXT NOT NULL CHECK (length(payload) < 200000),
  proposal_id  INTEGER UNIQUE,
  published_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL CHECK (kind IN ('song', 'struct', 'chord')),
  payload         TEXT NOT NULL CHECK (length(payload) < 200000),
  payload_hash    TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  base_version    INTEGER NOT NULL DEFAULT 0,
  submitter_user_id TEXT,
  submitter_name  TEXT,
  created_at      INTEGER NOT NULL,
  reviewed_at     INTEGER,
  reviewed_by     TEXT
);

-- Identical pending proposals are de-duplicated per kind. A rejected or
-- approved payload may be submitted again later.
CREATE UNIQUE INDEX IF NOT EXISTS proposals_pending_hash_idx
  ON proposals (kind, payload_hash)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS proposals_pending_idx
  ON proposals (status, created_at);

CREATE INDEX IF NOT EXISTS published_edits_proposal_idx
  ON published_edits (proposal_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

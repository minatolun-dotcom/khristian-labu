-- Admin review: per-song targets, submission fingerprints and reviewer records.
--
-- Everything here is additive, so rows written by older clients and older
-- Workers keep working. `base_rev` is NULL for proposals created before this
-- migration; those predate fingerprints and are reported as unverified rather
-- than being refused (see workers/api/src/revisions.mjs).

ALTER TABLE proposals ADD COLUMN target TEXT;
ALTER TABLE proposals ADD COLUMN base_rev TEXT;
ALTER TABLE proposals ADD COLUMN reviewed_by_name TEXT;

ALTER TABLE published_edits ADD COLUMN target TEXT;

-- One queue screen asks for a page of proposals per status, and the review page
-- asks for one proposal by id; both are cheap with these.
CREATE INDEX IF NOT EXISTS proposals_status_recent_idx
  ON proposals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS proposals_target_idx
  ON proposals (target, created_at DESC);

-- Replaying the published layer for one song (original/preview, staleness).
CREATE INDEX IF NOT EXISTS published_edits_target_idx
  ON published_edits (target, seq);

-- Public submissions are unauthenticated, so a single address could otherwise
-- fill the shared 1,000-slot review queue and lock editors out. The cap is per
-- address; the address is never shown to readers or admins.
ALTER TABLE proposals ADD COLUMN submitter_ip TEXT;

CREATE INDEX IF NOT EXISTS proposals_pending_ip_idx
  ON proposals (status, submitter_ip);

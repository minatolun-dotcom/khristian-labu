-- Admin accounts can sign in with a username instead of an email. Better Auth
-- still requires an email row, so username-only admins store a private
-- <username>@admins.labu.local address that is never shown in the UI.
ALTER TABLE user ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_username_idx
  ON user (lower(username));

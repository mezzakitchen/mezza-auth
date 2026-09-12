-- For a database that already has the Mezza Operations tables (login_codes, sessions, rate_limits).
-- Adds only what the package needs on top. Run 0001 first (its CREATE IF NOT EXISTS are no-ops there).
ALTER TABLE sessions ADD COLUMN host TEXT;

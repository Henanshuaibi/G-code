ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1));
UPDATE users SET is_owner=1 WHERE id=(SELECT id FROM users WHERE role='admin' ORDER BY created_at,id LIMIT 1);
CREATE UNIQUE INDEX single_platform_owner ON users(is_owner) WHERE is_owner=1;
CREATE TABLE registration_challenges (
 id TEXT PRIMARY KEY, nonce TEXT NOT NULL, ip_digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL, consumed_at INTEGER
);

CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('user','admin')), disabled INTEGER NOT NULL DEFAULT 0,
 balance_micros INTEGER NOT NULL DEFAULT 0 CHECK(balance_micros BETWEEN 0 AND 1000000000000),
 reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros BETWEEN 0 AND balance_micros),
 rpm INTEGER NOT NULL, concurrency INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE sessions (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, window_at INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE cards (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, ciphertext TEXT,
 amount_micros INTEGER NOT NULL CHECK(amount_micros>0), created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, redeemed_by TEXT REFERENCES users(id), redeemed_at INTEGER, revoked_at INTEGER
);
CREATE TABLE models (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL DEFAULT 'chat' CHECK(protocol IN ('chat','responses')),
 enabled INTEGER NOT NULL DEFAULT 0, input_limit INTEGER NOT NULL DEFAULT 32768,
 output_limit INTEGER NOT NULL DEFAULT 4096, sale_price TEXT, price_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO models(id,name) VALUES('gcode-sol','GPT 6.1 Sol'),('gcode-flash','DeepSeek V4.1 Flash');
CREATE TABLE channels (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, key_ciphertext TEXT NOT NULL,
 protocol TEXT NOT NULL CHECK(protocol IN ('chat','responses')), priority INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, timeout_ms INTEGER NOT NULL, concurrency INTEGER NOT NULL,
 capabilities TEXT NOT NULL, usage_schema TEXT NOT NULL, evidence TEXT NOT NULL,
 discovered_models TEXT NOT NULL DEFAULT '[]', failures INTEGER NOT NULL DEFAULT 0, cooldown_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mappings (
 channel_id TEXT NOT NULL REFERENCES channels(id), model_id TEXT NOT NULL REFERENCES models(id),
 upstream_model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0,
 evidence TEXT NOT NULL, cost_price TEXT, version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(channel_id,model_id)
);
CREATE TABLE requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), model_id TEXT NOT NULL REFERENCES models(id),
 fingerprint TEXT NOT NULL, protocol TEXT NOT NULL, status TEXT NOT NULL,
 reserved_micros INTEGER NOT NULL, charged_micros INTEGER NOT NULL DEFAULT 0,
 price_snapshot TEXT NOT NULL, usage TEXT, emitted INTEGER NOT NULL DEFAULT 0,
 channel_id TEXT, code TEXT, created_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX request_user_time ON requests(user_id,created_at);
CREATE TABLE attempts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), channel_id TEXT NOT NULL REFERENCES channels(id),
 model_id TEXT NOT NULL REFERENCES models(id), cost_snapshot TEXT NOT NULL, usage_schema TEXT NOT NULL,
 budget_day TEXT NOT NULL, reserved_cny_micros INTEGER NOT NULL, cost_micros INTEGER NOT NULL DEFAULT 0,
 cost_cny_micros INTEGER NOT NULL DEFAULT 0, cost_kind TEXT NOT NULL DEFAULT 'reserved',
 status TEXT NOT NULL DEFAULT 'active', usage TEXT, code TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX attempt_channel_state ON attempts(channel_id,status);
CREATE TABLE cost_days (day TEXT PRIMARY KEY, spent_micros INTEGER NOT NULL DEFAULT 0, reserved_micros INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 amount_micros INTEGER NOT NULL, balance_after_micros INTEGER NOT NULL, request_id TEXT UNIQUE REFERENCES requests(id),
 card_id TEXT UNIQUE REFERENCES cards(id), actor_id TEXT REFERENCES users(id), reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), daily_cost_limit_micros INTEGER NOT NULL);
CREATE TABLE worker (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL);

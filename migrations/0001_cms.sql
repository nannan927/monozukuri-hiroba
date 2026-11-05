CREATE TABLE IF NOT EXISTS posts (
 slug TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 category TEXT NOT NULL,
 date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','published','trash')),
 document TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_status_date ON posts(status,date DESC);
CREATE TABLE IF NOT EXISTS revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 slug TEXT NOT NULL,
 version INTEGER NOT NULL,
 document TEXT NOT NULL,
 status TEXT NOT NULL,
 saved_at TEXT NOT NULL,
 UNIQUE(slug,version)
);
CREATE TABLE IF NOT EXISTS admin (
 id INTEGER PRIMARY KEY CHECK(id=1),
 password_hash TEXT,
 salt TEXT,
 setup_hash TEXT,
 setup_expires INTEGER,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 csrf TEXT NOT NULL,
 expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limits (
 bucket TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires INTEGER NOT NULL
);

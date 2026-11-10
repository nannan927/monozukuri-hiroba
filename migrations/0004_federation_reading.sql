-- Each attempt has its own identity, so a late Accept cannot revive an old Follow.
CREATE TABLE ap_subscriptions (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, inbox TEXT NOT NULL,
 name TEXT NOT NULL, profile_url TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelling','cancelled','deleted')),
 created_at TEXT NOT NULL, changed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ap_subscription_active ON ap_subscriptions(actor)
 WHERE status IN ('pending','accepted','cancelling');
CREATE TABLE ap_follow_jobs (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES ap_subscriptions(id),
 kind TEXT NOT NULL CHECK(kind IN ('Follow','Undo')), queued_at TEXT, completed_at TEXT
);
CREATE TABLE ap_follow_locks (actor TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE ap_received (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, object_id TEXT NOT NULL UNIQUE,
 actor TEXT NOT NULL, subscription_id TEXT NOT NULL REFERENCES ap_subscriptions(id),
 url TEXT NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL, summary TEXT NOT NULL,
 sensitive INTEGER NOT NULL DEFAULT 0, published TEXT, updated TEXT,
 revision_ms INTEGER NOT NULL, received_at TEXT NOT NULL
);
CREATE INDEX ap_received_subscription ON ap_received(subscription_id,seq);
CREATE TABLE ap_remote_deletions (
 object_id TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY(object_id,actor)
);

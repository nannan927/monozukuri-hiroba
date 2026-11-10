-- No backfill: installing federation never announces the existing archive.
CREATE TABLE ap_keys (id INTEGER PRIMARY KEY CHECK(id=1), public_jwk TEXT NOT NULL, private_jwk TEXT NOT NULL);
CREATE TABLE ap_followers (
 actor TEXT PRIMARY KEY, inbox TEXT NOT NULL, follow_id TEXT NOT NULL,
 followed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE ap_removed_follows (follow_id TEXT PRIMARY KEY, actor TEXT NOT NULL);
CREATE TABLE ap_publications (
 id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), slug TEXT NOT NULL,
 published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 deleted_at TEXT
);
CREATE UNIQUE INDEX ap_active_slug ON ap_publications(slug) WHERE deleted_at IS NULL;
CREATE TABLE ap_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, publication_id TEXT NOT NULL REFERENCES ap_publications(id),
 kind TEXT NOT NULL CHECK(kind IN ('Create','Update','Delete')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 queued_at TEXT
);
CREATE INDEX ap_pending_events ON ap_events(id) WHERE queued_at IS NULL;
CREATE TABLE ap_failures (id TEXT PRIMARY KEY, message TEXT NOT NULL, failed_at TEXT NOT NULL);
CREATE TRIGGER ap_post_insert AFTER INSERT ON posts WHEN NEW.status='published' BEGIN
 INSERT INTO ap_publications(slug) VALUES(NEW.slug);
 INSERT INTO ap_events(publication_id,kind) SELECT id,'Create' FROM ap_publications WHERE slug=NEW.slug AND deleted_at IS NULL;
END;
CREATE TRIGGER ap_post_publish AFTER UPDATE ON posts WHEN OLD.status!='published' AND NEW.status='published' BEGIN
 INSERT INTO ap_publications(slug) VALUES(NEW.slug);
 INSERT INTO ap_events(publication_id,kind) SELECT id,'Create' FROM ap_publications WHERE slug=NEW.slug AND deleted_at IS NULL;
END;
CREATE TRIGGER ap_post_update AFTER UPDATE ON posts WHEN OLD.status='published' AND NEW.status='published' BEGIN
 INSERT INTO ap_events(publication_id,kind) SELECT id,'Update' FROM ap_publications WHERE slug=NEW.slug AND deleted_at IS NULL;
END;
CREATE TRIGGER ap_post_unpublish AFTER UPDATE ON posts WHEN OLD.status='published' AND NEW.status!='published' BEGIN
 INSERT INTO ap_events(publication_id,kind) SELECT id,'Delete' FROM ap_publications WHERE slug=NEW.slug AND deleted_at IS NULL;
 UPDATE ap_publications SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=NEW.slug AND deleted_at IS NULL;
END;
CREATE TRIGGER ap_post_delete BEFORE DELETE ON posts BEGIN
 INSERT INTO ap_events(publication_id,kind) SELECT id,'Delete' FROM ap_publications WHERE slug=OLD.slug AND deleted_at IS NULL;
 UPDATE ap_publications SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=OLD.slug AND deleted_at IS NULL;
END;

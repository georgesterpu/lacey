CREATE TABLE scan_runs (id TEXT PRIMARY KEY, slot_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, heartbeat_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, cursor_email TEXT NOT NULL DEFAULT '', planning_done INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]');
--> statement-breakpoint
CREATE TABLE source_runs (run_id TEXT NOT NULL REFERENCES scan_runs(id), source_id TEXT NOT NULL REFERENCES sources(id), status TEXT NOT NULL, products INTEGER NOT NULL DEFAULT 0, variants INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, details TEXT, completed_at TEXT, PRIMARY KEY(run_id,source_id));
--> statement-breakpoint
ALTER TABLE sources ADD COLUMN live_snapshot_id TEXT;
--> statement-breakpoint
CREATE TABLE offer_snapshots (snapshot_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES scan_runs(id), id TEXT NOT NULL, source_id TEXT NOT NULL, product_id TEXT NOT NULL, title TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, fit TEXT NOT NULL, size_system TEXT NOT NULL, size TEXT NOT NULL, colour TEXT NOT NULL, price INTEGER NOT NULL, reference_price INTEGER, currency TEXT NOT NULL, image TEXT NOT NULL, url TEXT NOT NULL, available INTEGER NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
--> statement-breakpoint
CREATE INDEX snapshot_matching ON offer_snapshots(size_system,size,fit,available,price,snapshot_id);
--> statement-breakpoint
CREATE INDEX snapshot_run ON offer_snapshots(run_id,source_id);
--> statement-breakpoint
CREATE VIEW current_offers AS SELECT o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,o.checked_at,o.run_id FROM offer_snapshots o JOIN sources s ON s.id=o.source_id AND s.live_snapshot_id=o.snapshot_id UNION ALL SELECT o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,o.checked_at,NULL AS run_id FROM offers o JOIN sources s ON s.id=o.source_id WHERE s.live_snapshot_id IS NULL;
--> statement-breakpoint
CREATE TABLE product_checks (run_id TEXT NOT NULL, source_id TEXT NOT NULL, product_id TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL, details TEXT, payload TEXT, PRIMARY KEY(run_id,source_id,product_id));
--> statement-breakpoint
CREATE TABLE subscribers (email_hash TEXT PRIMARY KEY, email TEXT NOT NULL, unsubscribe_token TEXT NOT NULL UNIQUE, unsubscribed INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE digest_jobs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES scan_runs(id), email_hash TEXT NOT NULL REFERENCES subscribers(email_hash), status TEXT NOT NULL DEFAULT 'queued', candidates TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, sent_at TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, provider_id TEXT, error TEXT, UNIQUE(run_id,email_hash));
--> statement-breakpoint
CREATE INDEX digest_pending ON digest_jobs(run_id,status,next_attempt_at);
--> statement-breakpoint
CREATE INDEX digest_recipient ON digest_jobs(email_hash,sent_at);
--> statement-breakpoint
CREATE INDEX watches_recipient ON watches(email,active,email_verified);
--> statement-breakpoint
CREATE TABLE delivery_budget (day TEXT PRIMARY KEY, reserved INTEGER NOT NULL DEFAULT 0);

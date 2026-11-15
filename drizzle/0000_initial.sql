CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, adapter TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', last_attempt TEXT, last_success TEXT, product_count INTEGER NOT NULL DEFAULT 0, error TEXT);
--> statement-breakpoint
CREATE TABLE offers (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), product_id TEXT NOT NULL, title TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, fit TEXT NOT NULL, size_system TEXT NOT NULL, size TEXT NOT NULL, colour TEXT NOT NULL, price INTEGER NOT NULL, reference_price INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', image TEXT NOT NULL, url TEXT NOT NULL, available INTEGER NOT NULL, checked_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX offers_lookup ON offers(available, size_system, size, category, brand);
--> statement-breakpoint
CREATE TABLE price_history (offer_id TEXT NOT NULL, price INTEGER NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY(offer_id, observed_at));
--> statement-breakpoint
CREATE TABLE watches (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, query TEXT NOT NULL, category TEXT NOT NULL, fit TEXT NOT NULL, size_system TEXT NOT NULL, size TEXT NOT NULL, colour TEXT NOT NULL DEFAULT '', budget INTEGER NOT NULL, min_discount INTEGER NOT NULL DEFAULT 25, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, consent_at TEXT NOT NULL, unsubscribe_token TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE INDEX watches_owner ON watches(owner_id);
--> statement-breakpoint
CREATE TABLE feedback (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE notifications (id TEXT PRIMARY KEY, watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE, offer_id TEXT NOT NULL, price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, sent_at TEXT, error TEXT, UNIQUE(watch_id,offer_id,price));
--> statement-breakpoint
CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

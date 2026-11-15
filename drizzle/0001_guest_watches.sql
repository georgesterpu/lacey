ALTER TABLE watches ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE email_confirmations (watch_id TEXT PRIMARY KEY REFERENCES watches(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, sent_at TEXT NOT NULL);

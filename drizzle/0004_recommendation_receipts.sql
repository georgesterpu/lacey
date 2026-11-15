CREATE TABLE recommendation_receipts (email_hash TEXT NOT NULL REFERENCES subscribers(email_hash) ON DELETE CASCADE, shoe_key TEXT NOT NULL, status TEXT NOT NULL, job_id TEXT REFERENCES digest_jobs(id) ON DELETE SET NULL, created_at TEXT NOT NULL, sent_at TEXT, PRIMARY KEY(email_hash,shoe_key));
--> statement-breakpoint
CREATE INDEX recommendation_job ON recommendation_receipts(job_id,status);

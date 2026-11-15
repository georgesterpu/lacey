CREATE TABLE email_identities (
 owner_id TEXT NOT NULL,
 email TEXT NOT NULL,
 verified_at TEXT,
 token_hash TEXT UNIQUE,
 token TEXT,
 expires_at TEXT,
 sent_at TEXT,
 last_attempt_at TEXT,
 delivery_key TEXT,
 delivery_state TEXT NOT NULL DEFAULT 'pending',
 error_code TEXT,
 lease_until TEXT,
 PRIMARY KEY(owner_id,email)
);
--> statement-breakpoint
INSERT INTO email_identities(owner_id,email,verified_at,delivery_state)
 SELECT owner_id,email,max(created_at),'verified' FROM watches WHERE email_verified=1 GROUP BY owner_id,email;
--> statement-breakpoint
UPDATE watches SET email_verified=1 WHERE EXISTS(SELECT 1 FROM email_identities i WHERE i.owner_id=watches.owner_id AND i.email=watches.email AND i.verified_at IS NOT NULL);

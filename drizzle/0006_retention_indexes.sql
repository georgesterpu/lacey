CREATE INDEX IF NOT EXISTS snapshot_expiry ON offer_snapshots(checked_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS snapshot_offer_lookup ON offer_snapshots(id,snapshot_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_history_expiry ON price_history(observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS offers_source ON offers(source_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scan_started ON scan_runs(started_at DESC);

-- 00013: Webhook idempotency table
-- Prevents duplicate processing of Stripe webhook events

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup: remove events older than 7 days (Stripe retries within 72h max)
CREATE INDEX idx_webhook_events_processed_at ON webhook_events (processed_at);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write this table
GRANT ALL ON webhook_events TO service_role;

-- 00060: Marketplace Connector Infrastructure
-- Shared data model for listing agents on external marketplaces
-- (Google Cloud, Azure, AWS). Marketplace-agnostic internal model
-- with adapter-specific fields in JSONB.

-- Supported marketplaces
CREATE TYPE marketplace_provider AS ENUM ('google_cloud', 'azure', 'aws');
CREATE TYPE marketplace_listing_status AS ENUM ('draft', 'pending_review', 'active', 'suspended', 'delisted');
CREATE TYPE marketplace_subscription_status AS ENUM ('pending', 'active', 'suspended', 'canceled', 'expired');

-- ─────────────────────────────────────────────────────────────────
-- Listings: which agents are listed on which marketplaces
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE marketplace_listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider        marketplace_provider NOT NULL,
  status          marketplace_listing_status NOT NULL DEFAULT 'draft',

  -- External identifiers (set after marketplace accepts the listing)
  external_id     TEXT,                    -- marketplace-assigned listing/product ID
  external_url    TEXT,                    -- public URL on the marketplace

  -- Pricing config
  pricing_model   TEXT NOT NULL DEFAULT 'usage_based',  -- usage_based, subscription, free
  price_per_call  NUMERIC,                -- USD per agent call (usage-based)
  monthly_price   NUMERIC,                -- USD per month (subscription)

  -- Marketplace-specific config (SSO app IDs, webhook URLs, etc.)
  provider_config JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(agent_id, provider)
);

CREATE INDEX idx_ml_agent ON marketplace_listings (agent_id);
CREATE INDEX idx_ml_provider_status ON marketplace_listings (provider, status);

-- ─────────────────────────────────────────────────────────────────
-- Subscriptions: customer subscriptions from any marketplace
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE marketplace_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider          marketplace_provider NOT NULL,

  -- Customer identity
  external_customer_id TEXT NOT NULL,      -- marketplace customer/tenant ID
  customer_name     TEXT,
  customer_email    TEXT,

  -- Subscription state
  status            marketplace_subscription_status NOT NULL DEFAULT 'pending',
  plan_id           TEXT,                  -- marketplace plan identifier
  quantity          INTEGER DEFAULT 1,     -- seats/units (per-user pricing)

  -- External identifiers
  external_subscription_id TEXT NOT NULL,  -- marketplace subscription ID
  external_data     JSONB DEFAULT '{}',    -- marketplace-specific subscription data

  -- Lifecycle timestamps
  activated_at      TIMESTAMPTZ,
  canceled_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(provider, external_subscription_id)
);

CREATE INDEX idx_ms_listing ON marketplace_subscriptions (listing_id);
CREATE INDEX idx_ms_agent ON marketplace_subscriptions (agent_id, status);
CREATE INDEX idx_ms_external ON marketplace_subscriptions (provider, external_customer_id);

-- ─────────────────────────────────────────────────────────────────
-- Usage events: metered usage to report back to marketplaces
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE marketplace_usage_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES marketplace_subscriptions(id) ON DELETE CASCADE,
  listing_id        UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  provider          marketplace_provider NOT NULL,

  -- Usage data
  dimension         TEXT NOT NULL DEFAULT 'api_calls',  -- metering dimension
  quantity          NUMERIC NOT NULL DEFAULT 1,          -- units consumed
  usage_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Reporting state
  reported          BOOLEAN NOT NULL DEFAULT false,
  reported_at       TIMESTAMPTZ,
  external_usage_id TEXT,                  -- ID returned by marketplace after reporting
  report_error      TEXT,                  -- error message if reporting failed

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mue_pending ON marketplace_usage_events (reported, provider)
  WHERE reported = false;
CREATE INDEX idx_mue_subscription ON marketplace_usage_events (subscription_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- RLS: service role only for all marketplace tables
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_usage_events ENABLE ROW LEVEL SECURITY;

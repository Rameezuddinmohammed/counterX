-- Self-serve merchant onboarding, Steps 3-6: catalog review, own-gateway
-- Razorpay payment connect, readiness evidence, and the persisted capability
-- manifest. Extends migration 0015's tables (manual_catalog_items gets a
-- `reviewed` flag; onboarding_applications gets a `catalog_confirmed_at`
-- timestamp used as Step 5's mapping_freshness evidence timestamp) and adds
-- two new tables.
--
-- SECURITY, payment_connections.key_secret: this is the merchant's OWN
-- Razorpay API key secret (self-serve "bring your own gateway" credentials —
-- see apps/control-plane-api/src/merchant-payment-connection-store.ts's
-- header for the full scope disclosure: it is verified against the real
-- Razorpay API but NOT wired into the actual checkout/worker payment path
-- yet). This repo has no precedent anywhere for application-level encryption
-- of a stored secret (see migration 0013's header, which made the identical
-- disclosure for shopify_connections.access_token) — every sensitive column
-- in this schema relies solely on the "direct-SQL trust boundary, RLS
-- enabled+forced with NO policies" convention, never pgcrypto or app-level
-- encryption. This table follows that SAME convention rather than inventing
-- a new one. KNOWN LIMITATION, not solved here: encryption-at-rest for this
-- column would be a real hardening step, tracked, not silently skipped.
--
-- RLS is enabled and forced on both new tables for structural consistency
-- with the rest of merchant.*, but no policies are defined: same direct-SQL
-- trust boundary as merchant.onboarding_applications (migration 0015) and
-- merchant.shopify_connections (migration 0013). No policies means any
-- future non-bypassing role is denied by default until real RBAC policies
-- are added.

ALTER TABLE merchant.manual_catalog_items
  ADD COLUMN reviewed boolean NOT NULL DEFAULT false;

ALTER TABLE merchant.onboarding_applications
  ADD COLUMN catalog_confirmed_at timestamptz;

CREATE TABLE merchant.payment_connections (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  provider text NOT NULL,
  key_id text NOT NULL,
  key_secret text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT payment_connections_provider CHECK (provider = 'razorpay'),
  CONSTRAINT payment_connections_key_id_not_empty CHECK (char_length(key_id) > 0),
  CONSTRAINT payment_connections_key_secret_not_empty CHECK (char_length(key_secret) > 0),
  CONSTRAINT payment_connections_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT payment_connections_validity CHECK (updated_at >= created_at),
  CONSTRAINT payment_connections_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

-- Durable home for a self-serve merchant's generated CapabilityManifest
-- (packages/merchant-application/src/capability-manifest.ts). One current
-- manifest per merchant — a re-generation (e.g. after goods types change and
-- a new manifest is confirmed) overwrites the row rather than versioning
-- history, matching this table's role as "the currently active manifest",
-- not an audit trail.
CREATE TABLE merchant.capability_manifests (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  manifest_version text NOT NULL,
  capabilities text[] NOT NULL,
  fulfillment_capabilities text[] NOT NULL DEFAULT '{}',
  -- VersionBindings (connectorVersion, mappingSchemaHash, policyVersion,
  -- protocolVersion, paymentProviderVersion) — stored as jsonb rather than
  -- five separate columns since this is an opaque, append-only evidence
  -- snapshot the application layer owns the shape of, not the database.
  version_bindings jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  signature_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT capability_manifests_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT capability_manifests_version_not_empty CHECK (char_length(manifest_version) > 0),
  CONSTRAINT capability_manifests_capabilities_not_empty CHECK (array_length(capabilities, 1) > 0),
  CONSTRAINT capability_manifests_signature_format
    CHECK (signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT capability_manifests_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

ALTER TABLE merchant.payment_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.payment_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.capability_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.capability_manifests FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS merchant.capability_manifests;
DROP TABLE IF EXISTS merchant.payment_connections;
ALTER TABLE merchant.onboarding_applications DROP COLUMN IF EXISTS catalog_confirmed_at;
ALTER TABLE merchant.manual_catalog_items DROP COLUMN IF EXISTS reviewed;

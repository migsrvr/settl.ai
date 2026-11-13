-- Additive upgrade: optional agent-facing metadata on endpoints (description, input schema, example).
-- Review/apply deliberately against the intended database BEFORE deploying code that selects these columns:
--   npm exec -w web -- prisma db execute --file prisma/endpoint-metadata-upgrade.sql
-- No existing endpoint, price, URL, payment or policy data is changed.
BEGIN;
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "input_schema" JSONB;
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "example" JSONB;
COMMIT;

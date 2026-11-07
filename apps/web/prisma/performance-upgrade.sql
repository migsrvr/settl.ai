-- Additive upgrade for databases created before the performance snapshot fields.
-- Review/apply deliberately against the intended database before deploying code.
-- No historical payment, policy, wallet, provider URL, or funding data is changed.
BEGIN;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "cached_pending_balance" BIGINT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "pending_balance_updated_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "payments_status_confirmed_at_idx" ON "payments"("status", "confirmed_at");
CREATE INDEX IF NOT EXISTS "quotes_endpoint_id_created_at_idx" ON "quotes"("endpoint_id", "created_at");
CREATE INDEX IF NOT EXISTS "claims_provider_id_created_at_idx" ON "claims"("provider_id", "created_at");
COMMIT;

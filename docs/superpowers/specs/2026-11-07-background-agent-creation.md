# Background agent creation

Approved and implemented locally on November 7. Hosted rollout and a live creation rehearsal remain separate operational steps.

## Behavior and interfaces

- `POST /api/agents` authenticates the buyer, validates the policy, and atomically commits custody, policy, hashed API key, and a versioned queued creation checkpoint. It returns HTTP 202 with `{ agentId, status: "provisioning", apiKey }` without account funding or blockchain registration in the response path.
- The API key is shown once in the current creation form. Progress reads, logs, checkpoints and browser storage never contain it. Unknown submission responses lock the form and direct the buyer to review existing agents.
- Next.js `after()` starts the saved job immediately. Scheduling failure cannot discard the committed one-time key; the durable queue remains available to scheduled recovery.
- `GET /api/agents/[id]/provisioning` is a buyer-owned, read-only, `private, no-store` projection: agent status, stage, state, update time, public transaction hashes, normalized error code and review flag. It exposes no custody, worker lease or Velo recovery identities.
- The UI shows Queued → Preparing wallets → Registering device → Registering spending limits → Ready. It polls every two seconds while visible, stops on terminal status, bounds reads to ten seconds and refreshes controls once on activation. Creation responses are bounded to fifteen seconds without automatically repeating the POST. Policy editing retains its existing flow.

## Durable worker

- Reuse `Agent.lifecycleRecovery` JSON; no schema migration, queue product, SDK contract change or MCP tool change is required. New jobs carry `version: 1, operation: "create"`, a stage/state, timestamp, transaction identities and an optional tokenized lease. Queued state remains `working` to preserve the existing owner guard.
- Acquire the existing owner advisory lock and agent row lock only for the database claim. Compare-and-swap updates fence stale workers. A lease lasts 270 seconds; execution stops after 220 seconds, and a cron batch starts jobs only within its first ten seconds (at most five candidates by default).
- Prepare distinct wallet accounts concurrently. Device registration and policy registration remain sequential. Activate only after both stages are confirmed. Reject expired policies before starting new stages; still reconcile an already-submitted transaction after expiry.
- Persist an unresolved stage marker before chain preparation and a signed inner hash before network submission. The provisioning-only submitter also saves Velo identities before waiting and a relayer outer hash before sending. Store identities, never signed envelopes or API keys.
- Pending/unknown submissions are observed through stored identities, never sponsored or submitted again. Missing identities, mismatches and legacy checkpoints fail closed for review. Confirmed prior stages are not repeated. Interrupted safe account checks may resume.
- Existing authenticated automation GET/POST processes a bounded provisioning batch independently of the other queues. Provisioning failures report safe aggregate errors without suppressing other processing.

## Rollout and verification

- Existing databases need the already-supported lifecycle checkpoint field; this feature adds no columns. It does not apply the earlier provider balance-cache upgrade or repair missing provider fields.
- Configure and verify an external one-minute authenticated recovery schedule before enabling this creation flow in production. No recurring schedule is currently provisioned or verified by this implementation. Do not treat `after()` alone as durable recovery across deployments/process loss.
- Target a warm creation response within two seconds, measuring it separately from blockchain activation. This is a target, not a measured production result. Sanitized timing separates database preparation, wallet checks and settlement.
- Tests cover immediate keys with stalled blockchain work, account concurrency, stage ordering, leases/CAS, expiry, uncertain submissions, Velo/relayer identity persistence, tenant isolation, no credential leakage, visibility cleanup, key retention and no automatic duplicate creation. Full repository checks are required before completion.

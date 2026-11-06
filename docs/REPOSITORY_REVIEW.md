# Repository inspection for submission

Inspected November 7, 2026. Scope: tracked-file inventory, root/workspace manifests, all three apps and four packages, server/payment boundaries, Prisma schema/seed, route and test inventory, deployment configuration, runbooks, specifications, handoff and the supplied handbook. This is a submission-focused inspection, not a line-by-line security audit or a new live payment test.

## What the repository contains

| Area | Inspected responsibility |
| --- | --- |
| `apps/web` | Next.js 16 provider/buyer pages, demo session selection, agent-scoped MCP/REST, shared broker, policy/approval/claim/top-up handlers and Prisma persistence |
| `apps/resibo` | Standalone Express JSON fixture API, payment middleware, bundled Vercel function and health endpoint |
| `apps/agent` | LLM tool calling, authenticated MCP client, validated receipt-expense ledger and durable operation journal |
| `packages/core` | Schemas, payment headers and exact amount conversion |
| `packages/sdk` | Express quote/payment verification and buffered JSON outcome handshake |
| `packages/stellar` | Noir SDK operation encoder/read reuse, Stellar17 envelope adapter, testnet guard, gas/refusal fallback, proofs and uncertain-result handling |
| `packages/verifier` | Deterministic schema, fields, confidence, totals and date checks |
| Supporting files | npm workspace/lockfile, test inventory, Vercel packaging, explicit live-test configuration, demo scripts and design/evidence history |

## Findings and changes

1. **Root README was stale.** It described implemented API/MCP/persistence/live dashboards as future work and used an older verification count. Replaced it with the exact handbook section order and current implementation boundaries.
2. **Monorepo/public status already satisfied structurally.** Root workspaces are `apps/*` and `packages/*`, installed from the root. GitHub's connected metadata reported `migsrvr/settl.ai` public. No visibility change or new repository was needed.
3. **Submission metadata was incomplete.** Added user-supplied Miggy Rivera / `_ra1ve`. The required two-minute video remains missing and is explicitly marked.
4. **Product narrative changed.** Current mock OCR charges PHP2 per call, including blurry fixtures. Kept optional outcome billing separate, including off-chain reservations. A Pro price refusal is application policy, not proof of an on-chain cap rejection.
5. **Deployed UI has older copy.** Landing/stage still contain outcome-first language, placeholder SDK package examples and older displayed contract IDs. Submission README uses actual source and handbook IDs. Application UI edits are outside this documentation task.
6. **Fresh live observations.** Provider pages loaded actual stored call/pricing data. Endpoint pricing said OCR PHP2 and Pro PHP15, on every call. The dashboard showed a Codex Purchasing Agent PHP2 paid record at November6 18:05:23 UTC with transaction `56a799be36aba98be4c8c33cf120fa542010cda0898b4ee9f0d9eec538711faa`. Buyer pages showed active agents alongside earlier setup errors, and pending top-ups alongside a completed load. No new purchase, API-key creation, funding, claim or reconciliation was performed.
7. **README evidence is attributable.** Historical Bookkeeper hashes come from the prior recorded handoff. The newly observed Codex record comes from the deployed UI. Explorer/Horizon data could not be freshly retrieved through the available web fetch, so no independent ledger re-verification is claimed.
8. **Configuration needed smaller templates.** Added provider/agent examples containing only the variables those processes use, plus optional runtime aliases/rehearsal options in the root template. No active environment file or secret was read, copied or changed for this task.
9. **Deadline sources disagree.** Supplied handbook says Nov7 noon Philippine time; handoff says Nov8 8AM. The conflict is recorded in [submission notes](SUBMISSION.md), without inventing a later organizer confirmation.
10. **Concurrent work appeared during inspection.** Prisma provider cache/index changes, timing helpers/tests and performance plan/spec files appeared after the initially clean status. These were not authored by this task and were preserved. No commit/push is performed, and they must not be swept into a documentation-only release.

## Fresh verification in this checkout

Runtime: Windows, **Node v24.19.0**, npm **11.17.0**. This Node version is below the documented Noir24 range. Dependencies were not reinstalled or patched for this documentation task.

| Check | Fresh result |
| --- | --- |
| `npm test` | **Failed**, exit1. Vitest cannot load missing `@rollup/rollup-win32-x64-msvc` in the existing installation. No passing suite is claimed. |
| `npm run typecheck` | **Failed**, exit1. Provider cannot resolve `@settl/sdk`; web cannot resolve `@settl/stellar`, with consequent implicit-any errors. Route type generation itself succeeded. |
| `npm run lint` | **Passed**, exit0. |
| `npm run build` | **Failed**, exit1. The workspace cannot invoke the `prisma` CLI in the existing installation. |

Earlier handoff verification recorded **752 tests**, typecheck, lint and build passing in a clean isolated Linux installation on Node24.22.1. That historical evidence does not replace today's failed local checks. A fresh supported-runtime installation and complete root checks remain required before claiming the current checkout is green. No database, deployed service or blockchain mutation is needed to run the offline checks.

README section order, local targets, source line anchors, screenshot files and exported pitch contents are checked separately as documentation/artifact validation. Application test failures are reported rather than hidden by those checks.

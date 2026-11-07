# Settl.ai Vercel deployment

Updated November 6, 2026. Both testnet submission deployments report READY and are public after the user's explicit approval. Fresh requests without Vercel credentials return HTTP 200 for the homepage and provider health, and Settl's own HTTP 401 JSON for MCP without an agent key. Provider URL updates, webhook setup and a hosted paid call still require completion.

## Projects

Deploy the current repository source as two projects. Do not publish an older Git commit and assume it contains the uncommitted fixes. A local-source CLI deployment can include them without committing or pushing. The user's repository instructions prohibit commits and pushes unless separately requested.

| Project | Root directory | Framework | Runtime |
| --- | --- | --- | --- |
| Settl application | `apps/web` | Next.js | Node 24.x, at least 24.22.1 |
| Demo provider | `apps/resibo` | Other / Node function (bundled Express) | Node 24.x, at least 24.22.1 |

Enable **Include source files outside of the Root Directory in the Build Step** for both projects. Their `vercel.json` files install and build with npm workspaces from the repository root. The web build generates Prisma. The provider bundles `@settl/sdk` and its workspace dependencies using pinned esbuild, then exports the compiled Express app through `api/index.mjs`. Its function explicitly includes `dist/**`; public paths rewrite to that handler. `public/robots.txt` supplies the static output directory required by Vercel's generic framework builder. The default health endpoint does not initiate a purchase. Deployment configuration allows 300 seconds for API/MCP settlement and provider verification. Keep Fluid compute enabled and inspect the actual applied limits.

The web app traces shared packages from the repository root. `.vercelignore` excludes local environment files, generated output, payment logs and dependencies from CLI source uploads. Supply credentials through Vercel's environment settings; never embed them in configuration JSON or Git.

## Environment and persistent state

Use the existing Neon database and preserve the existing `WALLET_ENC_KEY`, treasury wallet and contract addresses. Replacing the encryption key makes existing encrypted wallets unreadable. Use the same Velo project/credentials as the already-created checkout. Do not reset or reseed the database as part of deployment.

| Web environment | Value source |
| --- | --- |
| `DATABASE_URL` | Existing configured Neon connection |
| `WALLET_ENC_KEY` | Existing encryption key, unchanged |
| `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Existing Stellar testnet configuration |
| `NOIR_DEVICE_REGISTRY_ID`, `NOIR_AGENT_REGISTRY_ID`, `NOIR_PAYMENT_ESCROW_ID` | Existing explicit deployed contract addresses |
| `VELO_API_KEY`, `VELO_GAS_API_KEY`, `VELO_WEBHOOK_SECRET` | Existing Velo project credentials; signing secret must match its webhook endpoint |
| `SETTL_TREASURY_SECRET`, optional `SETTL_RELAYER_SECRET` | Existing testnet wallets |
| `SETTL_PROVIDER_KEY` | Same shared service credential on web and provider |
| `SETTL_PROVIDER_ALLOWED_ORIGINS` | Provider's stable public HTTPS origin, without a path |
| `PHP_PER_XLM` | Existing fixed demo rate, `15` |
| `CRON_SECRET` | Existing secret if using the protected automation worker |

| Provider environment | Value |
| --- | --- |
| `SETTL_API_URL` | Stable public Settl application origin |
| `SETTL_PROVIDER_KEY` | Same credential as the web app |

The provider does not need database, encryption, wallet, or Velo secrets. Codex keeps its scoped buyer agent key and uses the deployed `/mcp` URL.

## Connect and verify

1. Obtain the two stable public project origins and configure environment variables before the final production build.
2. Deploy the provider and web app, fixing build failures rather than disabling checks. Confirm both report Ready.
3. Verify the provider's `/health` returns HTTP 200 and the expected service name. Verify the website opens.
4. Update the existing stored endpoint URLs for `resibo_parse`, `resibo_pro` and `geoph_lookup` to the provider origin plus `/parse-receipt`, `/parse-receipt-pro` and `/lookup`. Preserve endpoint IDs, prices and agent/provider ownership. The allowed-origin variable does not update stored endpoint URLs. Do not create duplicate products.
   Apply the November 7 mock usage-billing decision to the existing database with `npm exec -w web -- tsx prisma/demo-usage-billing.ts --apply` in its intended environment. This only switches Resibo's original `resibo_parse` from outcome to per-call and clears its old criteria; it does not update URLs, submit payments, or rebill old receipts. Deployment alone does not change stored endpoint settings. Preserve the existing approval requirement for hosted database credential use and URL updates.
5. Configure Velo's signed webhook endpoint to `<WEB_ORIGIN>/api/velo/webhook`. It must be reachable without a Vercel login gate. Configure the corresponding signing secret in the web project's server environment. Redeploy if an environment value changes.
6. Inspect the original checkout's status and webhook delivery. If it was paid but delivery failed, redeliver that original notification if Velo supports it. Do not pay again or manually transfer over an unresolved top-up. Confirm `completed` funding, its transaction hash, and an observed Noir balance.
7. Change the Codex MCP URL to `<WEB_ORIGIN>/mcp`. Restart the client with its buyer token available and first call only `settl_get_budget` and `settl_list_services`.
8. Rehearse one deliberate purchase only after the balance and existing pending work are known. Verify buyer/provider records and the resulting Stellar hash. Provider claims remain a separate deliberate action.

Choose public callback access for this testnet submission deliberately. Deployment protection must not intercept Velo, authenticated MCP clients or the provider-to-Settl verification callback. Keep application bearer and webhook-signature verification enabled. Do not disable those checks to resolve a hosting login page.

The automation endpoint accepts **GET and POST `/api/cron/auto-claim`** with the same `Authorization: Bearer <CRON_SECRET>` check and uncached response. Missing configuration returns 503; missing or invalid credentials return 401 before any queue work. GET supports [Vercel Cron's authenticated invocation](https://vercel.com/docs/cron-jobs/manage-cron-jobs); existing external POST jobs remain compatible.

**No recurring job is provisioned or verified.** `apps/web/vercel.json` contains no `crons` entry, and the deployed team's tier has not been verified. [Vercel's cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) allow daily jobs on Hobby and minute intervals on Pro/Enterprise. Do not add a minute schedule until the deployment tier is confirmed to support it. A daily safety-net claim job does not provide prompt outbox delivery or webhook retries.

Background agent creation also depends on this recovery schedule. The creation POST queues durably and starts registration through Next.js `after()` immediately; the same authenticated automation endpoint now processes saved provisioning jobs after interrupted execution. Configure and verify the external one-minute schedule before deploying/enabling the new flow. A successful immediate background run does not prove scheduled recovery. Cron success responses include a safe `provisioning` count summary; stored transaction identities are observed rather than resubmitted. No new database columns are required for this feature.

Until a supported hosting schedule is provisioned, configure an external recurring job against the production origin with:

- Frequency: every minute (`* * * * *`), using POST (or the compatible GET), no request body, and the bearer value stored in the scheduler's secret store matching the deployed `CRON_SECRET`.
- Execution: avoid overlapping scheduled runs, allow up to the configured 300-second function duration, and alert on non-2xx or missed invocations. A 500 can indicate partial queue failure or unresolved funding; inspect the safe error code and existing recovery procedure rather than forcing a financial retry.
- Verification: after deployment and deliberate authorization to run this payment-affecting endpoint, confirm a real scheduled invocation's status and sanitized queue summary. An unauthorized probe or source configuration alone does not establish a working schedule. Record the scheduler identity and last successful run in the project handoff.

Each invocation reads at most 25 automation intents and 25 due deliveries. Ordinary webhook subscriptions are read once per outbox batch; live low-budget checks retain their transaction-scoped lookup. Delivery uses at most four concurrent HTTP sends per invocation, stops starting rows after 20 seconds, and retains the 10-second send timeout, 60-second CAS lease, stable delivery IDs and four-total-attempt retry limit. Subsequent scheduled runs drain remaining rows and backoff deadlines. Claims and low-budget financial effects remain sequential within the outbox; this change does not increase financial concurrency.

## Diagnose a webhook HTTP 400

**Confirmed November 6, 17:06 UTC:** the generated `payment.created` test failed with `invalid_velo_payload` / `invalid_project_fields`, after successful signature verification. Velo's backend emits an optional numeric `project.registryProjectId`; its alpha.4 SDK requires a string. Settl's compatibility adapter retains raw SDK verification first and accepts only that exact authenticated schema failure before strictly validating payment events with the backend's registry metadata shape. The signing secret does not need changing for this error. This adapter relies on the pinned SDK's verification-before-parsing behavior and must be reviewed on an SDK upgrade.

An HTTP 200 delivery to `www.velo-build.dev` may be Velo's temporary tester, which acknowledges requests by default. It does not validate Settl's signing secret or fund the agent. The destination must be Settl's own `/api/velo/webhook`.

The route logs `velo_webhook_rejected` with only its sanitized status and public error code. The SDK verification boundary logs `velo_webhook_verification_failed` with a fixed reason identifier, never the signed body, signature, secret or raw exception. In Vercel **Logs**, filter the web project by `velo_webhook` immediately after a test; Hobby retention is short.

| Code / reason | Next action |
| --- | --- |
| `invalid_velo_signature` / `signature_mismatch` | Match the endpoint's signing secret to the web project's production `VELO_WEBHOOK_SECRET`; remove accidental wrapping quotes and redeploy after a change. Do not substitute the Velo API key. |
| `invalid_velo_signature` / `missing_signature` | Confirm Velo is sending the signed callback to this route. |
| `invalid_velo_signature` / `signature_timestamp_outside_tolerance` | Request a fresh signed delivery; copying an old header fails the SDK's five-minute tolerance. |
| `invalid_velo_payload` | Inspect the fixed shape reason and compare the installed SDK's requirements with Velo's actual signed event. Changing the secret will not fix an event-schema mismatch. |
| `invalid_velo_delivery` | Confirm the sender includes `x-velo-delivery`. |
| `velo_payment_mismatch` | Reconcile the original stored intent against its expected amount, XLM asset, receiver, paid state and transaction hash; do not bypass matching or fund manually. |

In Velo **Test delivery**, select **payment.created** and click **Send test event**. A generated intent has no matching stored top-up, so Settl verifies and acknowledges it without funding. This is a delivery test only. Once it passes, the original paid intent still needs a fresh signed redelivery or deliberate operator reconciliation; the inspected Velo UI does not expose a redeliver button, and HTTP 400 is not automatically retried. Do not pay again to test the fix.

## Validation and current access

Run `npm test && npm run typecheck && npm run lint && npm run build` from the repository root in the compatible Linux/WSL environment used to install dependencies. Native Windows checks currently fail to start tests because the installed dependencies contain Linux Rollup but lack the Windows optional package; workspace links and Prisma executable resolution also block typecheck/build. Do not delete or reinstall the active WSL dependency tree from Windows merely to hide those errors.

Vercel team access was subsequently authorized for `team_Xg9E9oYVPw79KZqwMsJnosNt`. The two projects and their server environment settings have been created through the authenticated Vercel API. Local source snapshots were uploaded without committing or pushing. Native Windows checks remain unsuitable for this shared WSL installation, but a separate Node 24.22.1 Linux validation environment has run all 728 tests, typecheck, lint, the web build and provider bundle successfully. The web typecheck script now runs `next typegen` first, so clean checkouts generate `PageProps` and `LayoutProps` before TypeScript.

| Deployment | Stable domain | Project ID |
| --- | --- | --- |
| Web | `https://settl-ai-pi.vercel.app` | `prj_uMJRuW9WPLPbsAcw83fTBD0IolEK` |
| Provider | `https://settl-provider.vercel.app` | `prj_kzZO0Yt7gVU3PhQ9utXFe4pKBFCv` |

Verified deployment IDs: web `dpl_C7BwzYeLMVJ5PBrimD4JHtmfm8V9`; provider `dpl_6vCDTzV3VLibo2QqijfZcSpx97GJ`. The API source snapshots include local uncommitted fixes; Git HEAD remains `07e8eccaa62b6f1978827dc1534e8800fc646699`. No commit or push was performed.

The user subsequently authorized public access and Vercel login protection is disabled on both new projects. Demo sign-in and application API-key/webhook-signature verification remain unchanged. Automatic approval review again rejected passing the database credential into a temporary Vercel session to inspect top-up records because the latest user message specifically approved public access. Do not bypass that decision through another mechanism. Database endpoint URLs, payment/top-up rows, Velo webhook configuration and blockchain state have not been changed. Obtain specific consent for the database inspection and the three existing endpoint URL updates before completing those portions of the hosted demo.

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [monorepo source access](https://vercel.com/docs/monorepos/monorepo-faq), [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

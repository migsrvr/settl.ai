# Resibo demo provider

Standalone Express 5 provider for Settl's receipt parsing and geography demos. All responses use deterministic fixtures; receipt parsing does not call an OCR service.

Install dependencies from the repository root with npm workspaces, then start the provider from the root:

```sh
npm run dev -w @settl/resibo
```

For normal startup use `npm run start -w @settl/resibo`. The workspace runs its TypeScript source with `tsx`. The build checks types and bundles shared workspace code into `dist/server.mjs`; the Vercel Node function in `api/index.mjs` exports that compiled Express handler. This avoids runtime imports of uncompiled workspace TypeScript. Importing `src/server.ts` exports `app`, `createApp` and a default handler without opening a listener.

`GET /health` returns the provider's health without invoking a paid service. Vercel routes the public API paths through the compiled handler. See [the deployment guide](../../docs/VERCEL_DEPLOYMENT.md).

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Provider HTTP port, from 1 to 65535 | `3001` |
| `SETTL_API_URL` | Settl API base URL | `http://localhost:3000` |
| `SETTL_PROVIDER_KEY` | Provider bearer key for Settl API requests | Unset |

Provide a real provider key through the environment. Tests can use `createApp({ apiUrl, apiKey })` to configure the API connection without changing the environment.

| Route | Settl endpoint ID | Payment mode | Response |
| --- | --- | --- | --- |
| `POST /parse-receipt` | `resibo_parse` | Per call | Receipt fixture after transaction verification |
| `POST /parse-receipt-pro` | `resibo_pro` | Per call | Receipt fixture after transaction verification |
| `POST /lookup` | `geoph_lookup` | Per call | Fixed Makati, Philippines geography sample |

Send a JSON object to each route. Receipt routes accept an optional `fixture` field: `clean` (the default), `blurry`, or `wrong_total`.

```json
{ "fixture": "clean" }
```

The clean fixture has confidence `0.98`, date `2026-11-05`, total `1250.50`, and line amounts `1000` and `250.50`. The blurry fixture has confidence `0.42`. The wrong-total fixture has line amounts totaling `200` and a declared total of `500`. All three cost the same usage fee in per-call mode. No image or real OCR service is required: an empty JSON object or omitted input selects `clean`.

The broker charges an allowed per-call request before invoking this provider. A provider rejection or timeout afterward does not reverse a confirmed charge; its paid receipt includes a provider error. Policy refusals and unapproved requests do not charge. Existing databases must apply the scoped billing update described in [database setup](../web/prisma/README.md); changing source alone does not replace a stored outcome-mode endpoint.

Without `X-PAYMENT`, each route returns HTTP 402 with its Settl quote. Retry with the SDK's base64 JSON `X-PAYMENT` proof. The demo defaults use `{ kind: "tx", quoteId, txHash }`. The SDK verifies the payment and adds `X-PAYMENT-RECEIPT` before returning the fixture. The SDK also still supports explicitly configured outcome products with `{ kind: "commit", quoteId, reservationId }`: those alone submit the result for verification before charging, release failed checks without charge, and withhold output during unresolved settlement.

Unknown fixture values and non-object JSON bodies return HTTP 400 before contacting Settl. JSON bodies are limited to 64 KiB; oversized bodies return HTTP 413. Malformed JSON returns a safe HTTP 400 response.

Run workspace checks from the root:

```sh
npm run test -w @settl/resibo
npm run typecheck -w @settl/resibo
npm run build -w @settl/resibo
```

Tests mock Settl's HTTP API using `fetch` and exercise the provider through Supertest. They cover payment quotes, transaction and commit proofs, settlement receipts, all receipt fixtures, geography lookup, input validation, upstream failures, and importing the app without starting a server.

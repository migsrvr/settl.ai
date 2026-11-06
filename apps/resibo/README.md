# Resibo demo provider

Standalone Express 5 provider for Settl's receipt parsing and geography demos. All responses use deterministic fixtures; receipt parsing does not call an OCR service.

Install dependencies from the repository root with npm workspaces, then start the provider from the root:

```sh
npm run dev -w @settl/resibo
```

For normal startup use `npm run start -w @settl/resibo`. The workspace runs its TypeScript source with `tsx`; `build` checks types without emitting files. Importing `src/server.ts` exports `app` and `createApp` without opening a listener.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Provider HTTP port, from 1 to 65535 | `3001` |
| `SETTL_API_URL` | Settl API base URL | `http://localhost:3000` |
| `SETTL_PROVIDER_KEY` | Provider bearer key for Settl API requests | Unset |

Provide a real provider key through the environment. Tests can use `createApp({ apiUrl, apiKey })` to configure the API connection without changing the environment.

| Route | Settl endpoint ID | Payment mode | Response |
| --- | --- | --- | --- |
| `POST /parse-receipt` | `resibo_parse` | Outcome | Receipt fixture after verification and settlement |
| `POST /parse-receipt-pro` | `resibo_pro` | Per call | Receipt fixture after transaction verification |
| `POST /lookup` | `geoph_lookup` | Per call | Fixed Makati, Philippines geography sample |

Send a JSON object to each route. Receipt routes accept an optional `fixture` field: `clean` (the default), `blurry`, or `wrong_total`.

```json
{ "fixture": "clean" }
```

The clean fixture has confidence `0.98`, date `2026-11-05`, total `1250.50`, and line amounts `1000` and `250.50`. The blurry fixture has confidence `0.42`. The wrong-total fixture has line amounts totaling `200` and a declared total of `500`. These intentionally exercise the outcome verifier's passing, low-confidence, and mismatched-total cases.

Without `X-PAYMENT`, each route returns HTTP 402 with its Settl quote. Retry with the SDK's base64 JSON `X-PAYMENT` proof. Outcome proofs use `{ kind: "commit", quoteId, reservationId }`; per-call proofs use `{ kind: "tx", quoteId, txHash }`. The SDK checks outcome reservations, submits the actual fixture result for verification and settlement, and adds `X-PAYMENT-RECEIPT` before returning the fixture. A failed outcome check returns the fixture with a `not_charged` receipt; an unresolved settlement returns a safe gateway error.

Unknown fixture values and non-object JSON bodies return HTTP 400 before contacting Settl. JSON bodies are limited to 64 KiB; oversized bodies return HTTP 413. Malformed JSON returns a safe HTTP 400 response.

Run workspace checks from the root:

```sh
npm run test -w @settl/resibo
npm run typecheck -w @settl/resibo
npm run build -w @settl/resibo
```

Tests mock Settl's HTTP API using `fetch` and exercise the provider through Supertest. They cover payment quotes, transaction and commit proofs, settlement receipts, all receipt fixtures, geography lookup, input validation, upstream failures, and importing the app without starting a server.

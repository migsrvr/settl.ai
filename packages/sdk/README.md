# @settl/sdk

Express middleware for Settl per-call payments. Importing the package includes
the Express request augmentation for `req.settlReceipt`.

```ts
import express from "express";
import { settl } from "@settl/sdk";

const app = express();
app.post("/parse-receipt", settl({ endpointId: "registered-endpoint-id" }), (req, res) => {
  res.json({ receipt: req.settlReceipt, result: "provider result" });
});
```

## Describe the endpoint in code

Instead of copying an `endpointId` from the dashboard, describe the endpoint and Settl registers it the first time it is needed:

```ts
const ocr = settl({ provider: "acme", name: "Receipt OCR", price: "2.00", url: `${PUBLIC_URL}/parse-receipt` });
app.post("/parse-receipt", ocr, (req, res) => res.json(parseReceipt(req.body)));
await ocr.register();   // optional: list it now, so agents can find it before any request
```

- Optional `description`, `inputSchema` (JSON Schema, object root) and `example` tell agents what the service does and what to send. Settl refuses non-matching input before any payment. On an existing endpoint, registration fills metadata it does not have yet and reports any difference as `drift` without overwriting it.
- `price` is pesos per call. `url` is the public URL Settl calls after payment; its path becomes the route.
- Registration is lazy (never at import time, so a Next.js build makes no network call) and shared: concurrent requests make one attempt, and a failed attempt is retried on the next request.
- Registering again is safe. An existing endpoint's price, name and URL are never changed through the provider key: if your code differs, the SDK logs one warning and the registered values stay. Change them in the dashboard.
- Per-call endpoints only. Outcome-billed endpoints are still registered in the dashboard and used by `endpointId`.
- A deployed gateway requires `provider` to exist already and `url` to be on the operator's allowed origins. The local sandbox creates the provider for you.
- `registerEndpoint(options)` does the same without a middleware.

## Any framework with Request and Response

`withSettl(handler, options)` gates a web-standard handler, so it works in Next.js route handlers, Hono, Bun, Deno and Workers. The handler receives the confirmed `receipt`, plus the framework's own second argument as `context`.

```ts
import { withSettl } from "@settl/sdk";

export const POST = withSettl(
  async (request, { receipt }) => Response.json({ paidWith: receipt?.txHash }),
  { provider: "acme", name: "Receipt OCR", price: "2.00", url: `${PUBLIC_URL}/api/parse-receipt` },
);
```

Outcome-billed endpoints must return a JSON response; it is held until Settl has verified exactly that output, then returned with the receipt header. Anything else answers 502. `withSettl` returns the same payment results and headers as `settl`.

## Express options

`settl({ endpointId, apiUrl?, apiKey? })` returns an Express `RequestHandler`.
`apiUrl` defaults to `SETTL_API_URL` or `http://localhost:3000`; `apiKey` defaults
to `SETTL_PROVIDER_KEY`. When present, the key is sent as a Bearer credential.
An explicit empty `apiKey` disables environment authentication. URLs must use
HTTP(S) without credentials, query parameters, or fragments. Node must provide
the built-in `fetch`, `AbortController`, and `Buffer` APIs.

Requests without `X-PAYMENT` receive a validated quote with HTTP 402. Transaction
proofs are decoded with `@settl/core` and verified by `POST /api/payments/verify`,
with the configured `endpointId` bound alongside the proof. Only a validated
`paid` receipt matching the submitted quote ID and transaction hash permits
the handler to run. The receipt is available on `req.settlReceipt` and in
`X-PAYMENT-RECEIPT` as base64-encoded UTF-8 JSON.

Malformed payment headers receive 400; rejected payments and commitments
receive 402. Payment rejections include the trusted verification API's
nonempty error string, with a generic fallback when that string is absent.
Network errors, non-2xx responses, invalid API bodies, and
receipt mismatches receive a generic 502. Each API request has a ten-second
deadline covering fetch and body parsing. Redirects are rejected.

Outcome commitments first claim a held reservation through `POST /api/verify`
with `checkOnly: true`, quote ID, reservation ID and endpoint ID. After the
provider calls `res.json`, the middleware buffers a JSON snapshot and posts that
exact result to `/api/verify`. Only a known pass/paid or fail/not-charged receipt
allows the original JSON to be delivered with its receipt header. Settlement
has a 120-second deadline because it may wait for Stellar. Uncertain settlement
returns a safe 502 and leaves reconciliation to the broker. Outcome handlers
must send JSON through `res.json`; streaming and raw responses are not supported.

The API must authenticate providers and enforce the submitted endpoint binding.
Provider keys remain server-side. This workspace exports TypeScript source,
matching the other Settl packages.

import { HEADER_PAYMENT, type Receipt } from "@settl/core";
import { createGateway, gate, HEADER_RECEIPT, receiptHeaderValue, settleOutcome, unavailable, type SettlOptions } from "./core";

export interface SettlContext<C = unknown> {
  /**
   * The confirmed payment for per-call endpoints. Outcome endpoints run before settlement,
   * so there is no receipt yet; it arrives in the response header.
   */
  receipt?: Receipt;
  /** The framework's own second argument, for example Next.js route params. */
  context?: C;
}

export type SettlHandler<C = unknown> = (request: Request, settl: SettlContext<C>) => Response | Promise<Response>;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Copy the response so frameworks that return immutable headers still work. */
function withReceipt(response: Response, receipt: Receipt, body: BodyInit | null = response.body): Response {
  const headers = new Headers(response.headers);
  headers.set(HEADER_RECEIPT, receiptHeaderValue(receipt));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export type SettlRoute<C = unknown> = ((request: Request, context?: C) => Promise<Response>) & {
  /** Register now (when described in code) and resolve to the endpoint id. Registration is otherwise lazy. */
  register(): Promise<string>;
};

/**
 * Gate a web-standard handler `(Request) => Response` on a verified Settl payment.
 * Works anywhere that uses the Fetch API: Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers.
 */
export function withSettl<C = unknown>(handler: SettlHandler<C>, opts: SettlOptions): SettlRoute<C> {
  const gateway = createGateway(opts);

  const route = async (request: Request, context?: C): Promise<Response> => {
    const decision = await gate(gateway, request.headers.get(HEADER_PAYMENT));
    if (decision.action === "reply") return reply(decision.status, decision.body);

    const extra = context === undefined ? {} : { context };
    if (decision.action === "paid") {
      // Handler failures belong to the framework, outside payment error handling.
      const response = await handler(request, { receipt: decision.receipt, ...extra });
      return withReceipt(response, decision.receipt);
    }

    // Outcome billing: the output is held until Settl has verified exactly this output.
    const response = await handler(request, { ...extra });
    const text = await response.text();
    let result: unknown;
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
      return reply(502, { error: "Provider result unavailable" });
    }
    try {
      result = JSON.parse(text);
    } catch {
      return reply(502, { error: "Provider result unavailable" });
    }
    try {
      const receipt = await settleOutcome(gateway, decision.identity, result);
      return withReceipt(response, receipt, text);
    } catch {
      return reply(502, unavailable);
    }
  };
  return Object.assign(route, { register: () => gateway.endpointId() });
}

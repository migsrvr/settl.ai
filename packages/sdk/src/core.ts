import {
  decodePaymentHeader,
  HEADER_RECEIPT,
  QuoteSchema,
  ReceiptSchema,
  type Receipt,
} from "@settl/core";
import { postJson, serviceUrl } from "./settlApi";

interface BaseOptions {
  /** Settl gateway origin. Defaults to SETTL_API_URL, then http://localhost:3000. */
  apiUrl?: string;
  /** Provider credential. Defaults to SETTL_PROVIDER_KEY. An explicit empty string sends none. */
  apiKey?: string;
}

/** Use an endpoint that is already registered (dashboard or earlier run). */
export interface EndpointIdOptions extends BaseOptions {
  endpointId: string;
}

/** Describe the endpoint in code; Settl registers it the first time it is needed. */
export interface RegisterOptions extends BaseOptions {
  /** Your provider id on the gateway. */
  provider: string;
  name: string;
  /** Price per call in pesos, for example "2.00". */
  price: string;
  /** Public URL of this endpoint, where Settl will call it after payment. */
  url: string;
  /** What the service does, shown to agents. Up to 500 characters. */
  description?: string;
  /**
   * JSON Schema (object root) for the input agents send. Settl refuses non-matching input
   * before any payment, so agents are never charged for calls your API would reject.
   */
  inputSchema?: Record<string, unknown>;
  /** An example input that matches inputSchema. */
  example?: unknown;
}

export type SettlOptions = EndpointIdOptions | RegisterOptions;

export interface Gateway {
  apiUrl: string;
  headers: Record<string, string>;
  /** Resolves the endpoint id, registering the endpoint once if it was described in code. */
  endpointId(): Promise<string>;
}

export interface OutcomeIdentity {
  quoteId: string;
  reservationId: string;
  endpointId: string;
}

export type Gate =
  | { action: "reply"; status: number; body: unknown }
  | { action: "paid"; receipt: Receipt }
  | { action: "commit"; identity: OutcomeIdentity };

export const unavailable = { error: "Payment service unavailable" } as const;

const PRICE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ROUTE = /^\/[A-Za-z0-9_/-]*$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeRegistration(opts: RegisterOptions) {
  if (typeof opts.provider !== "string" || !opts.provider.trim()) throw new Error("provider must be a non-empty string");
  if (typeof opts.name !== "string" || !opts.name.trim() || opts.name.length > 120) throw new Error("name must be 1 to 120 characters");
  if (typeof opts.price !== "string" || !PRICE.test(opts.price) || Number(opts.price) <= 0) {
    throw new Error('price must be a peso amount greater than zero, for example "2.00"');
  }
  let url: URL;
  try {
    url = new URL(opts.url);
  } catch {
    throw new Error("url must be the public http(s) URL of this endpoint");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !ROUTE.test(url.pathname)) {
    throw new Error("url must be an http(s) URL without credentials, query or fragment, with a path of letters, numbers, - _ and /");
  }
  if (opts.description !== undefined && (typeof opts.description !== "string" || !opts.description.trim() || opts.description.trim().length > 500)) {
    throw new Error("description must be 1 to 500 characters");
  }
  if (opts.inputSchema !== undefined && (!object(opts.inputSchema) || (opts.inputSchema.type !== undefined && opts.inputSchema.type !== "object"))) {
    throw new Error('inputSchema must be a JSON Schema object with "type": "object"');
  }
  return {
    providerId: opts.provider.trim(), name: opts.name.trim(), route: url.pathname, url: url.toString(), pricePhp: opts.price, mode: "per_call" as const,
    ...(opts.description !== undefined ? { description: opts.description.trim() } : {}),
    ...(opts.inputSchema !== undefined ? { inputSchema: opts.inputSchema } : {}),
    ...(opts.example !== undefined ? { example: opts.example } : {}),
  };
}

async function register(apiUrl: string, headers: Record<string, string>, body: ReturnType<typeof describeRegistration>): Promise<string> {
  const result = await postJson(`${apiUrl}/api/provider/register`, body, headers);
  if (!object(result) || typeof result.endpointId !== "string" || !result.endpointId.trim()) {
    throw new Error("Invalid registration response");
  }
  if (Array.isArray(result.drift) && result.drift.length > 0) {
    console.warn(
      `Settl: endpoint "${body.name}" (${result.endpointId}) is already registered with different ${result.drift.join(", ")}. `
      + "The registered values stay in force. Change them in the Settl dashboard, or register this code under a new route.",
    );
  }
  return result.endpointId;
}

/** Resolve gateway settings once, at middleware creation. Misconfiguration throws immediately. */
export function createGateway(opts: SettlOptions): Gateway {
  const registration = "endpointId" in opts ? undefined : describeRegistration(opts);
  if ("endpointId" in opts && (typeof opts.endpointId !== "string" || !opts.endpointId.trim())) {
    throw new Error("endpointId must be a non-empty string");
  }
  const apiUrl = serviceUrl(opts.apiUrl ?? (process.env.SETTL_API_URL || "http://localhost:3000"));
  const apiKey = opts.apiKey ?? process.env.SETTL_PROVIDER_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (registration === undefined) {
    const endpointId = (opts as EndpointIdOptions).endpointId;
    return { apiUrl, headers, endpointId: async () => endpointId };
  }
  let pending: Promise<string> | undefined;
  return {
    apiUrl, headers,
    endpointId() {
      // Share one in-flight registration; forget a failure so the next request retries.
      pending ??= register(apiUrl, headers, registration).catch((error: unknown) => { pending = undefined; throw error; });
      return pending;
    },
  };
}

/** Register an endpoint described in code, for example at server start. Returns its endpoint id. */
export function registerEndpoint(opts: RegisterOptions): Promise<string> {
  return createGateway(opts).endpointId();
}

export function receiptHeaderValue(receipt: Receipt): string {
  return Buffer.from(JSON.stringify(receipt), "utf8").toString("base64");
}

export { HEADER_RECEIPT };

/**
 * Decide what to do with an incoming request, independent of any web framework:
 * answer it (quote, bad proof, unavailable), let a paid request through, or hold an outcome commitment.
 */
export async function gate(gw: Gateway, raw: string | string[] | null | undefined): Promise<Gate> {
  if (raw === undefined || raw === null) {
    try {
      const endpointId = await gw.endpointId();
      const quote = QuoteSchema.parse(await postJson(`${gw.apiUrl}/api/quotes`, { endpointId }, gw.headers));
      return { action: "reply", status: 402, body: quote };
    } catch {
      return { action: "reply", status: 502, body: unavailable };
    }
  }

  let proof;
  try {
    if (typeof raw !== "string") throw new Error("Invalid payment header");
    proof = decodePaymentHeader(raw);
  } catch {
    return { action: "reply", status: 400, body: { error: "Invalid payment header" } };
  }

  let endpointId: string;
  try {
    endpointId = await gw.endpointId();
  } catch {
    return { action: "reply", status: 502, body: unavailable };
  }

  if (proof.kind === "commit") {
    const identity: OutcomeIdentity = { quoteId: proof.quoteId, reservationId: proof.reservationId, endpointId };
    let preflight: unknown;
    try {
      preflight = await postJson(`${gw.apiUrl}/api/verify`, { ...identity, checkOnly: true }, gw.headers);
    } catch {
      return { action: "reply", status: 502, body: unavailable };
    }
    if (!object(preflight) || preflight.ok !== true || preflight.quoteId !== proof.quoteId || preflight.reservationId !== proof.reservationId) {
      const error = object(preflight) && typeof preflight.error === "string" && preflight.error ? preflight.error : "Invalid payment commitment";
      return { action: "reply", status: 402, body: { error } };
    }
    return { action: "commit", identity };
  }

  let receipt: Receipt | null;
  let paymentError = "Payment verification failed";
  try {
    const result = await postJson(`${gw.apiUrl}/api/payments/verify`, { proof, endpointId }, gw.headers);
    if (!object(result) || !("ok" in result)) throw new Error("Invalid verification response");
    if (result.ok === false) {
      receipt = null;
      if (typeof result.error === "string" && result.error.trim()) paymentError = result.error;
    } else {
      if (result.ok !== true || !("receipt" in result)) throw new Error("Invalid verification response");
      receipt = ReceiptSchema.parse(result.receipt);
      if (receipt.status !== "paid" || receipt.quoteId !== proof.quoteId || receipt.txHash !== proof.txHash) {
        throw new Error("Invalid verification receipt");
      }
    }
  } catch {
    return { action: "reply", status: 502, body: unavailable };
  }
  if (receipt === null) return { action: "reply", status: 402, body: { error: paymentError } };
  return { action: "paid", receipt };
}

/**
 * Settle an outcome commitment on the exact output. Returns the receipt only for a confirmed
 * pass (paid) or fail (not charged); anything uncertain throws so the output is withheld.
 */
export async function settleOutcome(gw: Gateway, identity: OutcomeIdentity, result: unknown): Promise<Receipt> {
  const settlement = await postJson(`${gw.apiUrl}/api/verify`, { ...identity, result }, gw.headers, 120_000);
  if (!object(settlement) || !["pass", "fail"].includes(String(settlement.verification))) throw new Error("Settlement unresolved");
  const receipt = ReceiptSchema.parse(settlement.receipt);
  const passed = settlement.verification === "pass";
  if (receipt.quoteId !== identity.quoteId
    || (passed && (receipt.status !== "paid" || !/^[a-f0-9]{64}$/.test(receipt.txHash ?? "")))
    || (!passed && (receipt.status !== "not_charged" || receipt.amountStroops !== "0"))) {
    throw new Error("Settlement mismatch");
  }
  return receipt;
}

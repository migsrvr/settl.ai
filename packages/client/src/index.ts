import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Quote, Receipt } from "@settl/core";

export type { Quote, Receipt } from "@settl/core";

export interface ServiceInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  mode: "per_call" | "outcome";
  displayPrice: { currency: "PHP"; amount: string };
  amountStroops: string;
  /** What the service does, when the provider described it. */
  description?: string;
  /** JSON Schema for `input`. Input that does not match is refused before any payment. */
  inputSchema?: Record<string, unknown>;
  /** An example input that matches inputSchema. */
  example?: unknown;
}

export interface PendingApproval {
  id: string;
  providerId: string;
  quoteId: string;
  amountStroops: string;
  expiresAt: string;
}

export interface Budget {
  balanceStroops: string;
  balancePhp: string;
  /** "cache" when the balance was observed in the last 15 seconds, "chain" when read just now. */
  balanceSource?: "cache" | "chain";
  balanceAsOf?: string | null;
  availableStroops: string;
  spentTodayStroops: string;
  spentTodayPhp: string;
  heldStroops: string;
  remainingDailyBudgetStroops: string;
  openApprovals: number;
  pendingApprovals: PendingApproval[];
  policy: {
    asset: string;
    maxAmount: string;
    dailyBudget: string;
    maxPricePerCall: string;
    autoApproveUpTo: string;
    expiresAt: string;
    allowlist: string[];
  };
}

export interface Approval {
  id: string;
  providerId: string;
  quoteId: string;
  amountStroops: string;
  status: "pending" | "approved" | "declined" | "expired";
  expiresAt: string;
}

export interface ReceiptRecord {
  id: string;
  quoteId: string;
  serviceId: string;
  status: "paid" | "not_charged" | "blocked";
  amountStroops: string;
  displayPrice: { currency: "PHP"; amount: string };
  txHash?: string;
  submittedAt: string;
  confirmedAt: string | null;
  checks?: Array<{ check: string; ok: boolean; note: string }>;
}

/**
 * What a purchase attempt came to. Only `paid` means money moved, and `pending` means the outcome
 * is not yet known: never retry a pending call, check receipts first.
 */
export type CallResult =
  | { status: "paid"; receipt: Receipt; data: unknown; providerError?: string; next?: string }
  | { status: "approval_required"; reason: string; approvalId: string; next?: string }
  | { status: "declined" | "blocked"; reason: string; next?: string; /** Why input did not match the service's inputSchema. */ issues?: string[] }
  | { status: "not_charged"; reason: string; receipt?: Receipt; data?: unknown; next?: string }
  | { status: "pending"; reason: string; quoteId: string; txHash?: string; next?: string };

export interface ApprovalWait {
  /** False when the wait ran out before a human decided. */
  decided: boolean;
  approval: Approval;
  next: string;
}

export interface CallOptions {
  /** JSON the provider expects as input. */
  input?: unknown;
  /** The most you will pay for this call, in pesos, for example "10.00". */
  maxPricePhp?: string;
  /** Resume a call a human has approved. */
  approvalId?: string;
}

export interface CallAndWaitOptions extends CallOptions {
  /** How often to check the approval. Default 2000 ms. */
  pollMs?: number;
  /** How long to wait for a human before giving the approval back. Default 5 minutes. */
  approvalTimeoutMs?: number;
}

export interface SettlClientOptions {
  /** The agent's bearer key (stl_agent_...). Defaults to SETTL_AGENT_API_KEY. */
  apiKey?: string;
  /** The gateway's MCP URL. Defaults to SETTL_MCP_URL, then the sandbox at http://localhost:4000/mcp. */
  mcpUrl?: string;
}

export interface SettlClient {
  listServices(): Promise<{ services: ServiceInfo[] }>;
  getBudget(): Promise<Budget>;
  /** Price a service without charging it. */
  quote(serviceId: string): Promise<Quote>;
  call(serviceId: string, options?: CallOptions): Promise<CallResult>;
  /** Like `call`, but when a human must approve first, waits for the decision and then pays once. */
  callAndWait(serviceId: string, options?: CallAndWaitOptions): Promise<CallResult>;
  checkApproval(approvalId: string): Promise<{ approval: Approval }>;
  /** Wait on the gateway (up to 55 seconds per call) for a human to decide an approval. Never pays. */
  waitForApproval(approvalId: string, options?: { timeoutSeconds?: number }): Promise<ApprovalWait>;
  receipts(limit?: number): Promise<{ receipts: ReceiptRecord[] }>;
  /** Call any Settl MCP tool by name. */
  callTool(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** A Settl tool reported a failure; `code` is its public error code, for example APPROVAL_NOT_FOUND. */
export class SettlToolError extends Error {
  /** What the agent should do next, in plain language, when the gateway said. */
  readonly next?: string;
  /** Whether the same request can succeed later. */
  readonly retryable?: boolean;

  constructor(public readonly code: string, details: { message?: string; next?: string; retryable?: boolean } = {}) {
    super(details.message ? `${details.message} (${code})` : `Settl tool failed: ${code}`);
    this.name = "SettlToolError";
    if (details.next !== undefined) this.next = details.next;
    if (details.retryable !== undefined) this.retryable = details.retryable;
  }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function parseMcpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("mcpUrl must be a full URL such as https://your-gateway/mcp");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("mcpUrl must be an http(s) URL");
  if (url.username || url.password) throw new Error("mcpUrl must not contain credentials; pass the agent key as apiKey");
  if (url.search || url.hash) throw new Error("mcpUrl must not contain a query or fragment");
  if (url.protocol !== "https:" && !LOCAL_HOSTS.includes(url.hostname)) throw new Error("A remote mcpUrl must use https");
  return url;
}

export function decodeToolResult(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid MCP result");
  const result = raw as Record<string, unknown>;
  let value = result.structuredContent;
  if (value === undefined && Array.isArray(result.content)) {
    const text = result.content.find((item: unknown) => item && typeof item === "object"
      && (item as Record<string, unknown>).type === "text") as { text?: unknown } | undefined;
    if (typeof text?.text === "string") {
      try { value = JSON.parse(text.text); } catch { /* handled below */ }
    }
  }
  if (result.isError) {
    const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const text = (key: string) => (typeof body[key] === "string" ? body[key] as string : undefined);
    const message = text("message");
    const next = text("next");
    throw new SettlToolError(text("error") ?? "TOOL_FAILED", {
      ...(message !== undefined ? { message } : {}),
      ...(next !== undefined ? { next } : {}),
      ...(typeof body.retryable === "boolean" ? { retryable: body.retryable } : {}),
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP JSON object");
  return value as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connect an agent to a Settl gateway (hosted or the local sandbox) over MCP. */
export async function connectSettl(options: SettlClientOptions = {}): Promise<SettlClient> {
  const apiKey = options.apiKey ?? process.env.SETTL_AGENT_API_KEY;
  if (!apiKey) throw new Error("Pass apiKey or set SETTL_AGENT_API_KEY to the agent's stl_agent_ key");
  const endpoint = parseMcpUrl(options.mcpUrl ?? process.env.SETTL_MCP_URL ?? "http://localhost:4000/mcp");

  const mcp = new Client({ name: "settl-client", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" },
  });
  try {
    await mcp.connect(transport);
  } catch {
    await mcp.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw new Error("Could not connect to Settl. Check the mcpUrl and that the agent key is valid and active.");
  }

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    // Payment calls can wait on a blockchain, so allow longer than the default request timeout.
    return decodeToolResult(await mcp.callTool({ name, arguments: args }, { timeout: 130_000 }));
  }
  const call = async (serviceId: string, opts: CallOptions = {}) => await callTool("settl_call", {
    serviceId,
    ...(opts.input === undefined ? {} : { input: opts.input }),
    ...(opts.maxPricePhp === undefined ? {} : { maxPricePhp: opts.maxPricePhp }),
    ...(opts.approvalId === undefined ? {} : { approvalId: opts.approvalId }),
  }) as unknown as CallResult;
  const checkApproval = async (approvalId: string) => await callTool("settl_check_approval", { approvalId }) as unknown as { approval: Approval };
  const waitForApproval = async (approvalId: string, { timeoutSeconds = 25 }: { timeoutSeconds?: number } = {}) =>
    await callTool("settl_wait_for_approval", { approvalId, timeoutSeconds: Math.min(55, Math.max(1, Math.ceil(timeoutSeconds))) }) as unknown as ApprovalWait;
  let serverWaitAvailable = true;

  /** One decision step: wait on the gateway when it can, otherwise read the approval once. */
  async function nextDecision(approvalId: string, remainingMs: number, pollMs: number): Promise<Approval> {
    if (serverWaitAvailable) {
      try {
        return (await waitForApproval(approvalId, { timeoutSeconds: Math.min(55, Math.max(1, Math.ceil(remainingMs / 1000))) })).approval;
      } catch (error) {
        // Gateways older than settl_wait_for_approval answer with an unknown-tool protocol error.
        if (error instanceof SettlToolError) throw error;
        serverWaitAvailable = false;
      }
    }
    const { approval } = await checkApproval(approvalId);
    if (approval.status === "pending") await sleep(Math.min(pollMs, Math.max(0, remainingMs)));
    return approval;
  }

  return {
    listServices: async () => await callTool("settl_list_services") as unknown as { services: ServiceInfo[] },
    getBudget: async () => await callTool("settl_get_budget") as unknown as Budget,
    quote: async (serviceId) => await callTool("settl_quote", { serviceId }) as unknown as Quote,
    call,
    checkApproval,
    waitForApproval,
    receipts: async (limit = 20) => await callTool("settl_receipts", { limit }) as unknown as { receipts: ReceiptRecord[] },
    callTool,
    async callAndWait(serviceId, { pollMs = 2000, approvalTimeoutMs = 300_000, ...callOptions } = {}) {
      const first = await call(serviceId, callOptions);
      if (first.status !== "approval_required") return first;
      const deadline = Date.now() + approvalTimeoutMs;
      for (;;) {
        const approval = await nextDecision(first.approvalId, deadline - Date.now(), pollMs);
        // Pay at most once: only an approved decision resumes the call, and only with this approval id.
        if (approval.status === "approved") return call(serviceId, { ...callOptions, approvalId: first.approvalId });
        if (approval.status === "declined") return { status: "declined", reason: "approval_declined" };
        if (approval.status === "expired") return { status: "declined", reason: "approval_expired" };
        if (deadline - Date.now() <= 0) return { ...first, reason: "approval_pending" };
      }
    },
    async close() {
      try { await mcp.close(); } finally { await transport.close(); }
    },
  };
}

import type { CallResult } from "./broker";

export interface CodeInfo {
  /** What happened, in plain language. */
  message: string;
  /** What the agent should do next. */
  next: string;
  /** Whether trying the same request again later can succeed. */
  retryable: boolean;
}

export interface PublicToolError extends CodeInfo {
  error: string;
}

const info = (message: string, next: string, retryable = false): CodeInfo => ({ message, next, retryable });

/**
 * Every code an agent may see. Broker codes are static strings chosen by Settl, so exposing them leaks
 * nothing; anything not listed here is reported as TOOL_FAILED.
 */
const CODES: Record<string, CodeInfo> = {
  // Tool codes
  TOOL_FAILED: info("The request could not be completed.", "Try again shortly. If it keeps failing, check settl_receipts before buying again.", true),
  AGENT_UNAVAILABLE: info("This agent has no spending policy yet.", "Ask the agent's owner to finish setting it up in the Settl dashboard."),
  BALANCE_UNAVAILABLE: info("The balance could not be read right now.", "Try settl_get_budget again shortly. Purchases still check the real balance.", true),
  APPROVAL_NOT_FOUND: info("No approval with that id belongs to this agent.", "Use the approvalId returned by settl_call, or see pending ones in settl_get_budget."),
  // Broker codes
  agent_not_found: info("This agent no longer exists.", "Ask the owner for a new agent key."),
  agent_inactive: info("This agent is not active.", "Ask the owner to reactivate it in the Settl dashboard."),
  agent_policy_missing: info("This agent has no spending policy yet.", "Ask the agent's owner to finish setting it up in the Settl dashboard."),
  agent_hint_mismatch: info("The quote request named a different agent.", "Request the quote again without naming another agent."),
  endpoint_not_found: info("That service does not exist or is no longer offered.", "Call settl_list_services and pick a current serviceId."),
  invalid_endpoint_price: info("That service has an invalid price.", "Pick another service; the provider needs to fix its listing."),
  invalid_endpoint_url: info("That service is not reachable from Settl.", "Pick another service; the provider needs to fix its listing."),
  unsupported_endpoint_method: info("That service uses an unsupported HTTP method.", "Pick another service; the provider needs to fix its listing."),
  invalid_endpoint_criteria: info("That service has invalid result checks.", "Pick another service; the provider needs to fix its listing."),
  invalid_call_input: info("The input could not be sent to the provider.", "Send input as plain JSON, within 1 MB."),
  invalid_exchange_rate: info("Settl cannot price services right now.", "Try again shortly.", true),
  invalid_max_price: info("maxPricePhp is not a valid peso amount.", 'Send pesos with at most two decimals, for example "10.00".'),
  nonce_exhausted: info("This agent cannot sign more payments.", "Ask the owner to create a new agent."),
  payment_pending: info("An earlier payment from this agent is still unresolved.", "Do not retry. Check settl_receipts, then try again once it settles.", true),
  invalid_approval: info("That approval does not match this purchase.", "Call settl_call again without approvalId to request a new approval."),
  wallet_unavailable: info("The agent's wallet is temporarily unavailable.", "Try again shortly.", true),
  wallet_identity_mismatch: info("The agent's wallet does not match its registration.", "Ask the owner to check the agent in the Settl dashboard."),
  reservation_unavailable: info("The budget hold for this purchase could not be made.", "Check settl_get_budget, then try again.", true),
  quote_not_found: info("That quote does not exist.", "Request a new quote with settl_quote."),
  endpoint_mismatch: info("The quote belongs to a different service.", "Request a new quote for this service."),
  reservation_mismatch: info("The budget hold does not match this quote.", "Call settl_call again for a new hold."),
  reservation_already_in_use: info("This budget hold is already being used.", "Wait for the earlier call to finish, then check settl_receipts."),
  reservation_expired: info("The budget hold expired.", "Call settl_call again."),
};

/** Next steps for purchase results that are not errors. */
const REASONS: Record<string, string> = {
  over_max_price: "The price is above maxPricePhp. Raise maxPricePhp if the price is acceptable, or pick a cheaper service.",
  over_daily_budget: "Today's budget is used up. Check settl_get_budget; the budget resets at 00:00 UTC, or the owner can raise it.",
  provider_not_allowed: "This provider is not on the agent's allow list. Pick another provider, or ask the owner to allow this one.",
  agent_revoked: "This agent was revoked. Ask the owner for a new agent.",
  agent_expired: "This agent's policy expired. Ask the owner to renew it.",
  over_auto_approve: "A human must approve this price. Call settl_wait_for_approval with the approvalId, then call again with it once approved.",
  approval_declined: "A human declined this purchase. Do not retry it without asking.",
  approval_expired: "The approval expired. Call settl_call again to request a new one.",
  approval_already_used: "That approval was already used for a purchase. Call settl_call again without approvalId for a new one.",
  approval_pending: "No decision yet. Call settl_wait_for_approval again later, or resume with this approvalId once approved.",
  invalid_input: "The input does not match the service's inputSchema, so nothing was charged. Fix the input using settl_list_services and try again.",
  endpoint_unavailable: "The service is not reachable, so nothing was charged. Try another service.",
  provider_rejected: "The provider rejected the request and nothing was charged. Check the input against the service's inputSchema.",
  provider_unavailable: "The provider did not respond and nothing was charged. Try again later or pick another service.",
  provider_not_verified: "The provider's result could not be verified, so nothing was charged.",
  checks_failed: "The result failed the agreed checks, so nothing was charged.",
  onchain_failed: "The payment could not be authorized and nothing was charged. Check settl_get_budget.",
};

const STATUS_FALLBACK: Record<CallResult["status"], string> = {
  paid: "Use the data. The receipt proves the charge.",
  declined: "Nothing was charged. Adjust the request or pick another service.",
  blocked: "Nothing was charged. Check settl_get_budget and the agent's policy.",
  approval_required: "A human must approve this. Call settl_wait_for_approval with the approvalId.",
  not_charged: "Nothing was charged.",
  pending: "The outcome is not known yet. Do not retry; check settl_receipts first.",
};

export function describeCode(code: string): CodeInfo {
  return CODES[code] ?? CODES.TOOL_FAILED;
}

/** The public form of a thrown error: an allow-listed broker code, or TOOL_FAILED with nothing else. */
export function toolError(error: unknown): PublicToolError {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  const code = candidate && typeof candidate === "object" && candidate.name === "BrokerError"
    && typeof candidate.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(candidate.code) && candidate.code in CODES
    ? candidate.code : "TOOL_FAILED";
  return { error: code, ...describeCode(code) };
}

function nextFor(status: CallResult["status"], reason?: string): string {
  // Pending results must never suggest a retry, whatever the reason string says.
  if (status === "pending") return STATUS_FALLBACK.pending;
  return (reason && REASONS[reason]) || STATUS_FALLBACK[status];
}

type PublicReceipt = { quoteId: string; status: string; amountStroops: string; txHash?: string; checks?: Array<{ check: string; ok: boolean; note: string }> };

export interface PublicCallResult {
  status: CallResult["status"];
  reason?: string;
  approvalId?: string;
  quoteId?: string;
  txHash?: string;
  receipt?: PublicReceipt;
  data?: unknown;
  providerError?: string;
  /** Why the input did not match the service's inputSchema. */
  issues?: string[];
  next?: string;
}

function publicReceipt(receipt: PublicReceipt): PublicReceipt {
  return {
    quoteId: receipt.quoteId, status: receipt.status, amountStroops: receipt.amountStroops,
    ...(receipt.txHash !== undefined ? { txHash: receipt.txHash } : {}),
    ...(receipt.checks !== undefined ? { checks: receipt.checks.map(({ check, ok, note }) => ({ check, ok, note })) } : {}),
  };
}

/** What an agent sees from a purchase: built field by field, so internal effects and unknown fields never leave. */
export function publicCallResult(result: CallResult): PublicCallResult {
  switch (result.status) {
    case "paid":
      return {
        status: "paid", receipt: publicReceipt(result.receipt), data: result.data ?? null,
        ...(result.providerError ? {
          providerError: result.providerError,
          next: "The provider failed after payment, so the charge stands. Check settl_receipts before buying again.",
        } : {}),
      };
    case "approval_required":
      return { status: "approval_required", reason: result.reason, approvalId: result.approvalId, next: nextFor(result.status, result.reason) };
    case "pending":
      return {
        status: "pending", reason: result.reason, quoteId: result.quoteId,
        ...(result.txHash !== undefined ? { txHash: result.txHash } : {}), next: nextFor(result.status, result.reason),
      };
    case "not_charged":
      return {
        status: "not_charged", reason: result.reason,
        ...(result.receipt ? { receipt: publicReceipt(result.receipt) } : {}),
        ...(result.data !== undefined ? { data: result.data } : {}),
        next: nextFor(result.status, result.reason),
      };
    default:
      return {
        status: result.status, reason: result.reason,
        ...(result.issues?.length ? { issues: result.issues.slice(0, 5).map((issue) => issue.slice(0, 300)) } : {}),
        next: nextFor(result.status, result.reason),
      };
  }
}

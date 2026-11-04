// Off-chain spending rules, checked before Settl signs anything.
// Order follows docs/superpowers/specs/2026-11-04-settl-api-mcp-design.md §4.
// Amounts are stroops. The on-chain cap is enforced separately by agent_registry.

export type PolicyInput = {
  agent: { status: "active" | "revoked"; expiresAt: Date | null; allowlist: string[] };
  providerId: string;
  price: bigint;
  maxPrice: bigint;
  spentToday: bigint;
  reservedNow: bigint;
  dailyBudget: bigint;
  autoApproveUpTo: bigint;
  approval?: { status: "pending" | "approved" | "declined"; providerId: string; amount: bigint };
  now: Date;
};

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "blocked"; reason: "agent_revoked" | "agent_expired" | "provider_not_allowed" }
  | { decision: "declined"; reason: "over_max_price" | "over_daily_budget" | "approval_declined" }
  | { decision: "approval_required"; reason: "over_auto_approve" };

export function decide(p: PolicyInput): PolicyDecision {
  if (p.agent.status !== "active") return { decision: "blocked", reason: "agent_revoked" };
  if (p.agent.expiresAt && p.now > p.agent.expiresAt) return { decision: "blocked", reason: "agent_expired" };
  if (!p.agent.allowlist.includes(p.providerId)) return { decision: "blocked", reason: "provider_not_allowed" };
  if (p.price > p.maxPrice) return { decision: "declined", reason: "over_max_price" };
  if (p.spentToday + p.reservedNow + p.price > p.dailyBudget) return { decision: "declined", reason: "over_daily_budget" };

  if (p.price > p.autoApproveUpTo) {
    const a = p.approval;
    const matches = a && a.providerId === p.providerId && a.amount >= p.price;
    if (matches && a.status === "declined") return { decision: "declined", reason: "approval_declined" };
    if (!(matches && a.status === "approved")) return { decision: "approval_required", reason: "over_auto_approve" };
  }
  return { decision: "allow" };
}

// Decides what each state change sets off. Pure: the caller loads the context,
// then performs the returned effects (deliver webhooks, queue claims, send alerts).

export type SettlEvent =
  | "payment.paid"
  | "payment.not_charged"
  | "payment.blocked"
  | "approval.requested"
  | "approval.resolved"
  | "budget.low"
  | "topup.completed"
  | "claim.completed";

export type EffectContext = {
  subscriptions: { orgId: string; events: string[] }[];
  provider?: { id: string; orgId: string; pending: bigint; autoClaimAt: bigint | null };
  agent?: { id: string; orgId: string; balance: bigint; alertBelow: bigint | null; alertedToday: boolean };
};

export type Effect =
  | { kind: "webhook"; orgId: string; event: SettlEvent }
  | { kind: "auto_claim"; providerId: string }
  | { kind: "budget_low"; agentId: string };

function webhooksFor(event: SettlEvent, ctx: EffectContext): Effect[] {
  return ctx.subscriptions.filter((s) => s.events.includes(event)).map((s) => ({ kind: "webhook", orgId: s.orgId, event }));
}

export function planEffects(event: { type: SettlEvent }, ctx: EffectContext): Effect[] {
  const effects = webhooksFor(event.type, ctx);
  if (event.type !== "payment.paid") return effects;

  const { provider, agent } = ctx;
  if (provider && provider.autoClaimAt !== null && provider.pending >= provider.autoClaimAt) {
    effects.push({ kind: "auto_claim", providerId: provider.id });
  }
  if (agent && agent.alertBelow !== null && agent.balance < agent.alertBelow && !agent.alertedToday) {
    effects.push({ kind: "budget_low", agentId: agent.id }, ...webhooksFor("budget.low", ctx));
  }
  return effects;
}

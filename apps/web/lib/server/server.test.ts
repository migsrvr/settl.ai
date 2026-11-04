// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decide, type PolicyInput } from "./policy";
import { nextNonce } from "./nonce";
import { reservationReducer, type Reservation } from "./reservations";
import { signWebhook, verifyWebhook } from "./webhooks";
import { planEffects, type EffectContext } from "./events";

const NOW = new Date("2026-11-07T10:00:00Z");

const base: PolicyInput = {
  agent: { status: "active", expiresAt: new Date("2026-12-31T00:00:00Z"), allowlist: ["resibo", "geoph"] },
  providerId: "resibo",
  price: 1_333_334n,
  maxPrice: 3_333_334n,
  spentToday: 8_000_000n,
  reservedNow: 0n,
  dailyBudget: 13_333_334n,
  autoApproveUpTo: 3_333_334n,
  now: NOW,
};

describe("policy.decide", () => {
  it("allows a call inside every limit", () => {
    expect(decide(base)).toEqual({ decision: "allow" });
  });

  it("blocks a revoked or expired agent", () => {
    expect(decide({ ...base, agent: { ...base.agent, status: "revoked" } }).decision).toBe("blocked");
    expect(decide({ ...base, agent: { ...base.agent, expiresAt: new Date("2026-11-01T00:00:00Z") } }).decision).toBe("blocked");
  });

  it("blocks a provider that isn't on the allowlist", () => {
    expect(decide({ ...base, providerId: "other" })).toMatchObject({ decision: "blocked", reason: "provider_not_allowed" });
  });

  it("declines a price above the caller's max", () => {
    expect(decide({ ...base, price: 4_000_000n })).toMatchObject({ decision: "declined", reason: "over_max_price" });
  });

  it("counts open reservations against the daily budget", () => {
    expect(decide({ ...base, reservedNow: 4_000_001n })).toMatchObject({ decision: "declined", reason: "over_daily_budget" });
  });

  it("asks for approval above the auto-approve limit", () => {
    const pricey = { ...base, price: 5_333_334n, maxPrice: 6_000_000n };
    expect(decide(pricey)).toMatchObject({ decision: "approval_required" });
    expect(decide({ ...pricey, approval: { status: "approved", providerId: "resibo", amount: 5_333_334n } })).toEqual({ decision: "allow" });
  });

  it("ignores an approval for a different provider or a smaller amount", () => {
    const pricey = { ...base, price: 5_333_334n, maxPrice: 6_000_000n };
    expect(decide({ ...pricey, approval: { status: "approved", providerId: "geoph", amount: 5_333_334n } }).decision).toBe("approval_required");
    expect(decide({ ...pricey, approval: { status: "approved", providerId: "resibo", amount: 1n } }).decision).toBe("approval_required");
    expect(decide({ ...pricey, approval: { status: "declined", providerId: "resibo", amount: 5_333_334n } }).decision).toBe("declined");
  });
});

describe("nextNonce", () => {
  it("is strictly greater than the last nonce", () => {
    expect(nextNonce(0n)).toBe(1n);
    expect(nextNonce(184470n)).toBe(184471n);
  });
});

describe("reservations", () => {
  const r: Reservation = { id: "r1", status: "held", amount: 1_333_334n, expiresAt: new Date("2026-11-07T10:02:00Z") };

  it("settles a held reservation once", () => {
    const paid = reservationReducer(r, { type: "settle", txHash: "a".repeat(64) }, NOW);
    expect(paid.status).toBe("settled");
    expect(() => reservationReducer(paid, { type: "release", reason: "x" }, NOW)).toThrow();
  });

  it("releases on a failed result", () => {
    expect(reservationReducer(r, { type: "release", reason: "checks_failed" }, NOW).status).toBe("released");
  });

  it("can't settle after it expires", () => {
    expect(() => reservationReducer(r, { type: "settle", txHash: "a".repeat(64) }, new Date("2026-11-07T10:03:00Z"))).toThrow(/expired/);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "payment.paid", amount: "1333334" });
  const t = Math.floor(NOW.getTime() / 1000);

  it("verifies a signature it made", () => {
    const header = signWebhook(secret, body, t);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(secret, body, header, NOW)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret or a stale timestamp", () => {
    const header = signWebhook(secret, body, t);
    expect(verifyWebhook(secret, body + " ", header, NOW)).toBe(false);
    expect(verifyWebhook("other", body, header, NOW)).toBe(false);
    expect(verifyWebhook(secret, body, header, new Date(NOW.getTime() + 6 * 60_000))).toBe(false);
    expect(verifyWebhook(secret, body, "garbage", NOW)).toBe(false);
  });
});

describe("planEffects", () => {
  const ctx: EffectContext = {
    subscriptions: [
      { orgId: "resibo", events: ["payment.paid", "claim.completed"] },
      { orgId: "juans", events: ["budget.low", "approval.requested"] },
    ],
    provider: { id: "resibo", orgId: "resibo", pending: 86_000_000n, autoClaimAt: 80_000_000n },
    agent: { id: "bookkeeper", orgId: "juans", balance: 9_000_000n, alertBelow: 10_000_000n, alertedToday: false },
  };

  it("fans a paid payment out to webhooks, auto-claim and a low-budget alert", () => {
    const effects = planEffects({ type: "payment.paid" }, ctx);
    expect(effects).toEqual([
      { kind: "webhook", orgId: "resibo", event: "payment.paid" },
      { kind: "auto_claim", providerId: "resibo" },
      { kind: "budget_low", agentId: "bookkeeper" },
      { kind: "webhook", orgId: "juans", event: "budget.low" },
    ]);
  });

  it("skips auto-claim below the threshold and repeat alerts on the same day", () => {
    const quiet = {
      ...ctx,
      provider: { ...ctx.provider!, pending: 10n },
      agent: { ...ctx.agent!, alertedToday: true },
    };
    expect(planEffects({ type: "payment.paid" }, quiet)).toEqual([{ kind: "webhook", orgId: "resibo", event: "payment.paid" }]);
  });

  it("only sends webhooks for events an org subscribed to", () => {
    expect(planEffects({ type: "approval.requested" }, ctx)).toEqual([{ kind: "webhook", orgId: "juans", event: "approval.requested" }]);
  });
});

import { describe, expect, it } from "vitest";
import { decodePaymentHeader, encodePaymentHeader } from "./header";
import { fromStroops, phpToStroops, stroopsToPhp, toStroops } from "./amount";
import { QuoteSchema } from "./schemas";

describe("amounts", () => {
  it("converts XLM decimal strings to stroops and back", () => {
    expect(toStroops("2")).toBe(20_000_000n);
    expect(toStroops("0.1333334")).toBe(1_333_334n);
    expect(fromStroops(20_000_000n)).toBe("2.0000000");
    expect(fromStroops(toStroops("12.5"))).toBe("12.5000000");
  });

  it("rejects negative amounts and more than 7 decimals", () => {
    expect(() => toStroops("-1")).toThrow();
    expect(() => toStroops("0.12345678")).toThrow();
    expect(() => toStroops("abc")).toThrow();
  });

  it("prices pesos in stroops, rounding up so the provider is never short", () => {
    // 15 PHP per XLM: ₱2 = 0.13333333… XLM, rounded up to 1,333,334 stroops
    expect(phpToStroops(2, 15)).toBe(1_333_334n);
    expect(phpToStroops(15, 15)).toBe(10_000_000n);
  });

  it("shows stroops as pesos to the centavo", () => {
    expect(stroopsToPhp(1_333_334n, 15)).toBe(2);
    expect(stroopsToPhp(10_000_000n, 15)).toBe(15);
  });

  it("rejects a non-positive rate", () => {
    expect(() => phpToStroops(2, 0)).toThrow();
  });
});

describe("payment header", () => {
  it("round-trips both kinds", () => {
    const tx = { kind: "tx" as const, quoteId: "q_1", txHash: "a".repeat(64) };
    const commit = { kind: "commit" as const, quoteId: "q_2", reservationId: "r_9" };
    expect(decodePaymentHeader(encodePaymentHeader(tx))).toEqual(tx);
    expect(decodePaymentHeader(encodePaymentHeader(commit))).toEqual(commit);
  });

  it("rejects garbage and unknown kinds", () => {
    expect(() => decodePaymentHeader("not base64 json")).toThrow(/payment header/i);
    const bad = btoa(JSON.stringify({ kind: "auth", quoteId: "q" }));
    expect(() => decodePaymentHeader(bad)).toThrow(/payment header/i);
  });
});

describe("QuoteSchema", () => {
  const base = {
    settl: "0.1",
    quoteId: "q_1",
    mode: "per-call",
    network: "stellar:testnet",
    asset: "CDLZ…",
    amountStroops: "1333334",
    displayPrice: { currency: "PHP", amount: "2.00" },
    merchant: "GABC",
    escrowContract: "CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX",
    expiresAt: "2026-11-06T10:05:00Z",
    resource: "POST /parse-receipt",
    description: "Parse one receipt",
  };

  it("accepts a per-call quote", () => {
    expect(QuoteSchema.parse(base).mode).toBe("per-call");
  });

  it("requires criteria in outcome mode", () => {
    expect(() => QuoteSchema.parse({ ...base, mode: "outcome" })).toThrow();
    expect(QuoteSchema.parse({ ...base, mode: "outcome", criteria: { schema: "resibo.receipt.v1" } }).criteria?.schema).toBe(
      "resibo.receipt.v1",
    );
  });

  it("rejects a non-integer stroop amount", () => {
    expect(() => QuoteSchema.parse({ ...base, amountStroops: "1.5" })).toThrow();
  });
});

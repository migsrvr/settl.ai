// @vitest-environment node
import { describe, expect, it } from "vitest";
import { describeCode, publicCallResult, toolError } from "./mcp-errors";

const brokerError = (status: number, code: string) => Object.assign(new Error(code), { name: "BrokerError", status, code });

describe("toolError", () => {
  it("exposes an allow-listed broker code with a message, a next step and whether a retry can help", () => {
    expect(toolError(brokerError(400, "invalid_max_price"))).toEqual({
      error: "invalid_max_price",
      message: expect.stringMatching(/maxPricePhp/),
      next: expect.any(String),
      retryable: false,
    });
    expect(toolError(brokerError(503, "wallet_unavailable"))).toMatchObject({ error: "wallet_unavailable", retryable: true });
  });

  it("redacts anything that is not a known broker code", () => {
    for (const error of [
      new Error("database password super-secret"),
      Object.assign(new Error("unique"), { code: "P2002" }),
      brokerError(500, "made_up_code_with_secret"),
      brokerError(400, "Not A Code"),
      "a string",
      null,
    ]) {
      const result = toolError(error);
      expect(result.error).toBe("TOOL_FAILED");
      expect(JSON.stringify(result)).not.toMatch(/super-secret|P2002|made_up_code/);
    }
  });

  it("describes the tool's own codes", () => {
    expect(describeCode("APPROVAL_NOT_FOUND").next).toMatch(/settl_get_budget|approval/i);
    expect(describeCode("AGENT_UNAVAILABLE").retryable).toBe(false);
    expect(describeCode("TOOL_FAILED").retryable).toBe(true);
  });
});

describe("publicCallResult", () => {
  const receipt = { quoteId: "q1", status: "paid" as const, amountStroops: "100", txHash: "a".repeat(64), checks: [] };

  it("keeps a paid result and drops internal automation effects", () => {
    const result = publicCallResult({ status: "paid", receipt, data: { total: 1 }, effects: [{ kind: "webhook" } as never] });
    expect(result).toEqual({ status: "paid", receipt, data: { total: 1 } });
    expect(JSON.stringify(result)).not.toContain("effects");
  });

  it("turns a missing provider payload into null so the output is valid JSON", () => {
    expect(publicCallResult({ status: "paid", receipt, data: undefined, effects: [] })).toMatchObject({ data: null });
  });

  it("explains a charge that stands after a provider failure", () => {
    expect(publicCallResult({ status: "paid", receipt, data: null, effects: [], providerError: "provider_unavailable" }))
      .toMatchObject({ providerError: "provider_unavailable", next: expect.stringMatching(/charge/i) });
  });

  it.each([
    [{ status: "declined", reason: "over_max_price" }, /maxPricePhp|cheaper/],
    [{ status: "declined", reason: "over_daily_budget" }, /budget/i],
    [{ status: "blocked", reason: "provider_not_allowed" }, /allow/i],
    [{ status: "approval_required", reason: "over_auto_approve", approvalId: "ap1" }, /settl_wait_for_approval|approv/i],
    [{ status: "pending", reason: "payment_pending", quoteId: "q1" }, /do not retry|receipts/i],
    [{ status: "not_charged", reason: "provider_unavailable" }, /not charged|nothing/i],
    [{ status: "declined", reason: "some_future_reason" }, /\S/],
  ] as const)("adds a next step for %o", (input, pattern) => {
    const result = publicCallResult(input as never);
    expect(result.status).toBe(input.status);
    expect(result.next).toMatch(pattern);
  });

  it("keeps the identifiers an agent needs to continue", () => {
    expect(publicCallResult({ status: "approval_required", reason: "over_auto_approve", approvalId: "ap1" })).toMatchObject({ approvalId: "ap1" });
    expect(publicCallResult({ status: "pending", reason: "submission_unknown", quoteId: "q1", txHash: "b".repeat(64) }))
      .toMatchObject({ quoteId: "q1", txHash: "b".repeat(64) });
  });

  it("never forwards unexpected fields", () => {
    const result = publicCallResult({ status: "declined", reason: "over_max_price", secret: "never" } as never);
    expect(JSON.stringify(result)).not.toContain("never");
  });
});

import { describe, expect, it } from "vitest";
import { runChecks } from "./index";

const NOW = new Date("2026-11-07T12:00:00Z");
const CRITERIA = { schema: "resibo.receipt.v1", minConfidence: 0.85, lineItemsSumToTotal: { tolerance: 0.01 } };

const clean = {
  merchant_name: "Mercury Drug",
  date: "2026-11-07",
  total: 398,
  confidence: 0.97,
  line_items: [
    { description: "Paracetamol", amount: 120 },
    { description: "Vitamin C", amount: 278 },
  ],
};

function failed(result: ReturnType<typeof runChecks>) {
  return result.checks.filter((c) => !c.ok).map((c) => c.check);
}

describe("runChecks, receipt v1", () => {
  it("passes a clean receipt with all five checks", () => {
    const r = runChecks(CRITERIA, clean, NOW);
    expect(r.result).toBe("pass");
    expect(r.checks).toHaveLength(5);
  });

  it("fails low confidence and totals that don't add up", () => {
    const r = runChecks(CRITERIA, { ...clean, confidence: 0.62, total: 412.5 }, NOW);
    expect(r.result).toBe("fail");
    expect(failed(r)).toEqual(["confidence", "lineItemsSumToTotal"]);
  });

  it("allows totals within the tolerance", () => {
    expect(runChecks(CRITERIA, { ...clean, total: 398.01 }, NOW).result).toBe("pass");
  });

  it("fails a missing required field", () => {
    const { date: _date, ...noDate } = clean;
    expect(failed(runChecks(CRITERIA, noDate, NOW))).toContain("required");
  });

  it("fails a receipt dated in the future", () => {
    expect(failed(runChecks(CRITERIA, { ...clean, date: "2026-12-01" }, NOW))).toEqual(["dateSanity"]);
  });

  it("fails garbage input on the schema check without throwing", () => {
    for (const junk of [null, "text", 42, [], { total: "lots" }]) {
      const r = runChecks(CRITERIA, junk, NOW);
      expect(r.result).toBe("fail");
      expect(failed(r)).toContain("schema");
    }
  });

  it("returns error for an unknown criteria schema", () => {
    expect(runChecks({ schema: "nope.v9" }, clean, NOW).result).toBe("error");
  });
});

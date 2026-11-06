import { describe, expect, it } from "vitest";
import { formatPeso } from "./format";
import { resolveDemoAccount, DEMO_ACCOUNTS } from "./auth";
import { claimReducer, initialClaim } from "./claim";
import { laneFor, runStage, STAGE_SCENARIOS, initialStage } from "./stage";
import { filterCalls, filterActivity } from "./demo-data";

describe("formatPeso", () => {
  it("formats whole and fractional pesos with two decimals", () => {
    expect(formatPeso(2)).toBe("₱2.00");
    expect(formatPeso(86)).toBe("₱86.00");
    expect(formatPeso(1234.5)).toBe("₱1,234.50");
  });
});

describe("resolveDemoAccount", () => {
  it("maps the demo emails to their workspace, ignoring case and spaces", () => {
    expect(resolveDemoAccount(" Mara@example.com ")?.role).toBe("provider");
    expect(resolveDemoAccount("juan@example.com")?.role).toBe("buyer");
  });

  it("rejects any other email", () => {
    expect(resolveDemoAccount("someone@example.com")).toBeNull();
    expect(resolveDemoAccount("")).toBeNull();
  });

  it("sends each role to its own home", () => {
    expect(DEMO_ACCOUNTS.map((a) => a.home)).toEqual(["/provider", "/provider", "/buyer", "/buyer"]);
  });
});

describe("claimReducer", () => {
  it("walks idle, confirm, settling, done and moves pending into claimed", () => {
    let s = claimReducer(initialClaim, { type: "open" });
    expect(s.phase).toBe("confirm");
    s = claimReducer(s, { type: "confirm" });
    expect(s.phase).toBe("settling");
    s = claimReducer(s, { type: "settled" });
    expect(s).toMatchObject({ phase: "done", pending: 0, claimed: 136 });
  });

  it("cancel returns to idle without moving money", () => {
    const s = claimReducer(claimReducer(initialClaim, { type: "open" }), { type: "cancel" });
    expect(s).toEqual(initialClaim);
  });

  it("ignores settled unless a claim is settling", () => {
    expect(claimReducer(initialClaim, { type: "settled" })).toEqual(initialClaim);
  });
});

describe("stage", () => {
  it("shows every gate idle before a run", () => {
    expect(laneFor(initialStage).map((g) => g.status)).toEqual(["idle", "idle", "idle", "idle", "idle"]);
  });

  it("marks the gate being worked on as active mid-run", () => {
    const s = { ...initialStage, scenario: 0, step: 2, running: true };
    expect(laneFor(s).map((g) => g.status)).toEqual(["done", "done", "active", "idle", "idle"]);
  });

  it("a clean receipt pays the provider and spends the budget", () => {
    const s = runStage(initialStage, 0);
    expect(s.earned).toBe(initialStage.earned + 2);
    expect(s.budget).toBe(initialStage.budget - 2);
    expect(s.txs[0]).toContain("3f9a");
    expect(laneFor(s).every((g) => g.status === "done")).toBe(true);
  });

  it("a blurry receipt fails at the check and charges nothing", () => {
    const s = runStage(initialStage, 1);
    expect(s.earned).toBe(initialStage.earned);
    expect(laneFor(s).map((g) => g.status)).toEqual(["done", "done", "done", "fail", "skip"]);
    expect(laneFor(s)[4].label).toBe("Not charged");
  });

  it("the pro call is blocked at the limits gate", () => {
    const s = runStage(initialStage, 2);
    expect(laneFor(s)[1].status).toBe("blocked");
    expect(s.budget).toBe(initialStage.budget);
    expect(STAGE_SCENARIOS[2].label).toContain("₱15");
  });
});

describe("filters", () => {
  it("filters provider calls by status", () => {
    expect(filterCalls("all").length).toBe(5);
    expect(filterCalls("not").every((c) => c.status === "not")).toBe(true);
    expect(filterCalls("blocked")).toEqual([]);
  });

  it("filters buyer activity by kind", () => {
    expect(filterActivity("approval").map((a) => a.provider)).toEqual(["GeoPH"]);
    expect(filterActivity("all").length).toBe(5);
  });
});

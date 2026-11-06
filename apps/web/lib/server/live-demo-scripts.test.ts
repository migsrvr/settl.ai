// @vitest-environment node
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET_XLM, type TxResult } from "@settl/stellar";
import type { PrismaClient } from "../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { fundAgent, fundingAmount } from "../../../../scripts/fund-agent";
import { runLiveDemo } from "../../../../scripts/demo-e2e";
import type { Operation } from "../../../../apps/agent/src/ledger";

vi.mock("./db", () => ({ getDb: vi.fn() }));
const cleanHash = "a".repeat(64), geoHash = "b".repeat(64), blurryHash = "c".repeat(64);
const cleanPrice = 1_333_334n, geoPrice = 5_333_334n;

function demonstration() {
  let balance = 100_000_000n, spent = 0n, time = Date.parse("2026-11-06T08:00:00Z");
  const operations = new Map<string, Operation>();
  const receipts: Record<string, unknown>[] = [];
  const receipt = (quoteId: string, status: string, amount: bigint, txHash?: string) => ({ quoteId, status, amountStroops: amount.toString(), ...(txHash ? { txHash } : {}), checks: [{ check: "confidence", ok: status === "paid", note: status === "paid" ? "0.98 >= 0.85" : "0.42 < 0.85" }] });
  const approval = vi.fn().mockResolvedValueOnce("pending").mockResolvedValue("approved");
  const output = vi.fn();
  const callTool = vi.fn(async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (name === "settl_list_services") return { services: [
      { id: "resibo_parse", name: "OCR", providerId: "resibo", mode: "per_call", amountStroops: cleanPrice.toString(), displayPrice: { currency: "PHP", amount: "2.00" } },
      { id: "resibo_pro", name: "Pro", providerId: "resibo", mode: "per_call", amountStroops: "10000000", displayPrice: { currency: "PHP", amount: "15.00" } },
      { id: "geoph_lookup", name: "Lookup", providerId: "geoph", mode: "per_call", amountStroops: geoPrice.toString(), displayPrice: { currency: "PHP", amount: "8.00" } },
    ] };
    if (name === "settl_get_budget") return { balanceStroops: balance.toString(), balancePhp: "150.00", spentTodayStroops: spent.toString(), heldStroops: "0", remainingDailyBudgetStroops: (33_333_334n - spent).toString(), openApprovals: 0,
      policy: { asset: TESTNET_XLM, maxAmount: "6666667", dailyBudget: "33333334", maxPricePerCall: "6666667", autoApproveUpTo: "3333334", expiresAt: "2026-12-31T00:00:00Z", allowlist: ["resibo", "geoph"] } };
    if (name === "settl_receipts") return { receipts };
    if (name === "settl_check_approval") return { approval: { id: "approval-1", quoteId: "q-geoph", providerId: "geoph", amountStroops: geoPrice.toString(), expiresAt: "2026-12-31T00:00:00Z", status: await approval() } };
    if (name !== "settl_call") throw new Error("Unexpected tool");
    expect([...operations.values()].some((op) => op.status === "submitted")).toBe(true);
    if (args.serviceId === "resibo_pro") return { status: "declined", reason: "over_max_price" };
    if (args.serviceId === "geoph_lookup" && !args.approvalId) return { status: "approval_required", reason: "over_auto_approve", approvalId: "approval-1" };
    if (args.serviceId === "geoph_lookup") {
      balance -= geoPrice; spent += geoPrice;
      const paid = { ...receipt("q-geoph", "paid", geoPrice, geoHash), checks: [] }; receipts.push(paid);
      return { status: "paid", receipt: paid, data: { city: "Makati" } };
    }
    if ((args.input as { fixture: string }).fixture === "blurry") {
      balance -= cleanPrice; spent += cleanPrice;
      const paid = { ...receipt("q-blurry", "paid", cleanPrice, blurryHash), checks: [] }; receipts.push(paid);
      return { status: "paid", receipt: paid, data: { confidence: 0.42 } };
    }
    balance -= cleanPrice; spent += cleanPrice;
    const paid = { ...receipt("q-clean", "paid", cleanPrice, cleanHash), checks: [] }; receipts.push(paid);
    return { status: "paid", receipt: paid, data: { confidence: 0.98 } };
  });
  const proof = { readAuthorizeTx: vi.fn(async (hash: string) => ({ ok: true, args: { agent: "GAGENT", deviceHash: "a".repeat(64), merchant: "GMERCHANT", asset: TESTNET_XLM, amount: hash === geoHash ? geoPrice : cleanPrice, nonce: 1n } })) };
  const ledger = { load: vi.fn(async () => {}), operation: (key: string) => operations.get(key), saveOperation: vi.fn(async (key: string, op: Operation) => { operations.set(key, op); }) };
  const sleep = vi.fn(async (ms: number) => { time += ms; });
  return { callTool, output, proof, operations, approval, ledger, sleep, setBalance: (value: bigint) => { balance = value; }, options: { connection: { callTool, close: vi.fn(async () => {}) }, proof, ledger, output, pause: async () => {}, sleep, now: () => time, endpoint: "http://localhost:3000/mcp", approvalTimeoutMs: 9000 } };
}

describe("real-demo orchestration without simulated success", () => {
  it("confirms usage charges for clean and blurry mocks and resumes the exact approval once", async () => {
    const demo = demonstration();
    await runLiveDemo(demo.options);
    const writes = demo.callTool.mock.calls.filter(([name]) => name === "settl_call");
    expect(writes).toHaveLength(5);
    expect(writes[0][1]).toEqual({ serviceId: "resibo_parse", input: { fixture: "clean" }, maxPricePhp: "10.00" });
    expect(writes[4][1]).toEqual({ serviceId: "geoph_lookup", input: { city: "Makati" }, maxPricePhp: "10.00", approvalId: "approval-1" });
    expect(demo.proof.readAuthorizeTx).toHaveBeenCalledTimes(3);
    expect(demo.operations.get("demo:blurry")).toMatchObject({ status: "paid", txHash: blurryHash });
    expect(demo.sleep).toHaveBeenCalledWith(3000);
    const text = demo.output.mock.calls.map(([line]) => line).join("\n");
    expect(text).toContain(`https://stellar.expert/explorer/testnet/tx/${cleanHash}`);
    expect(text).toContain(`https://stellar.expert/explorer/testnet/tx/${blurryHash}`);
    expect(text).toContain("http://localhost:3000/buyer/approvals/approval-1");
    expect(text).toContain("over_max_price");
  });
  it("persists uncertainty and refuses to repeat an interrupted call on the next run", async () => {
    const demo = demonstration();
    const original = demo.callTool.getMockImplementation()!;
    demo.callTool.mockImplementation(async (name, args) => {
      if (name === "settl_call") throw new Error("private transport details");
      return original(name, args);
    });
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/reconcil/i);
    expect([...demo.operations.values()]).toContainEqual(expect.objectContaining({ status: "unknown" }));
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/recorded|reconcil/i);
    expect(demo.callTool.mock.calls.filter(([name]) => name === "settl_call")).toHaveLength(1);
  });
  it("does not continue after a pending payment", async () => {
    const demo = demonstration();
    const original = demo.callTool.getMockImplementation()!;
    demo.callTool.mockImplementation(async (name, args) => name === "settl_call" ? { status: "pending", quoteId: "q-pending" } : original(name, args));
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/pending|reconcil/i);
    expect(demo.operations.get("demo:clean")).toMatchObject({ status: "pending", quoteId: "q-pending" });
    expect(demo.callTool.mock.calls.filter(([name]) => name === "settl_call")).toHaveLength(1);
  });
  it("refuses a paid claim without actual ledger authorization evidence", async () => {
    const demo = demonstration();
    demo.proof.readAuthorizeTx.mockResolvedValue({ ok: false, args: { agent: "", deviceHash: "", merchant: "", asset: TESTNET_XLM, amount: 0n, nonce: 0n } });
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/ledger|authorization/i);
    expect(demo.callTool.mock.calls.filter(([name]) => name === "settl_call")).toHaveLength(1);
  });
  it("rejects stale outcome billing before making any new purchase", async () => {
    const demo = demonstration();
    const original = demo.callTool.getMockImplementation()!;
    demo.callTool.mockImplementation(async (name, args) => {
      const result = await original(name, args);
      if (name === "settl_list_services") (result.services as Record<string, unknown>[])[0].mode = "outcome";
      return result;
    });
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/setup/i);
    expect(demo.callTool.mock.calls.filter(([name]) => name === "settl_call")).toHaveLength(0);
  });
  it("does not claim a usage charge when the observed balance is wrong", async () => {
    const demo = demonstration();
    const original = demo.callTool.getMockImplementation()!;
    demo.callTool.mockImplementation(async (name, args) => {
      const value = await original(name, args);
      if (name === "settl_call" && (args.input as { fixture?: string })?.fixture === "blurry") demo.setBalance(1n);
      return value;
    });
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/balance/i);
  });
  it.each(["declined", "expired"])("does not resume a %s approval", async (status) => {
    const demo = demonstration(); demo.approval.mockReset().mockResolvedValue(status);
    await expect(runLiveDemo(demo.options)).rejects.toThrow(/approval/i);
    expect(demo.callTool.mock.calls.filter(([name, args]) => name === "settl_call" && args.serviceId === "geoph_lookup")).toHaveLength(1);
  });
  it("bounds approval polling and never creates a second approval on timeout", async () => {
    const demo = demonstration(); demo.approval.mockReset().mockResolvedValue("pending");
    await expect(runLiveDemo({ ...demo.options, approvalTimeoutMs: 3000 })).rejects.toThrow(/approval/i);
    expect(demo.callTool.mock.calls.filter(([name, args]) => name === "settl_call" && args.serviceId === "geoph_lookup")).toHaveLength(1);
    expect(demo.approval).toHaveBeenCalledTimes(1);
  });
});

function funding() {
  const treasury = Keypair.random(), owner = Keypair.random(), agentWallet = Keypair.random();
  const agent = { id: "bookkeeper", orgId: "org_juan", status: "active", deviceHash: "a".repeat(64), agentPublic: agentWallet.publicKey(), org: { walletPublic: owner.publicKey() } };
  const rows = new Map<string, Record<string, unknown>>();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    agent: { findUnique: vi.fn().mockResolvedValue(agent), update: vi.fn().mockResolvedValue(agent) },
    topup: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      findFirst: vi.fn(async () => [...rows.values()].find((row) => row.status === "funding") ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.set(String(data.id), { ...data, fundTxHash: null }); return rows.get(String(data.id)); }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const value = { ...rows.get(where.id), ...data }; rows.set(where.id, value); return value; }),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as unknown as PrismaClient;
  const result: TxResult = { status: "SUCCESS", hash: cleanHash, innerHash: cleanHash, transport: "relayer" };
  const chain = { getPolicy: vi.fn().mockResolvedValue({ owner: owner.publicKey(), agent: agent.agentPublic, asset: TESTNET_XLM, maxAmount: 10n, expiresAt: 0n }),
    balanceOf: vi.fn().mockResolvedValue(1_333_334n),
    fundEscrow: vi.fn(async () => { expect([...rows.values()].some((row) => row.status === "funding")).toBe(true); return result; }),
  };
  return { tx, rows, chain, treasury, options: { db, chain, treasury, agentId: "bookkeeper", amount: 1_333_334n, escrowContract: "CESCROW" } };
}

describe("operator testnet treasury funding", () => {
  it("defaults to PHP50 converted to stroops and validates explicit stroop amounts", () => {
    expect(fundingAmount(undefined, 15)).toBe(33_333_334n);
    expect(fundingAmount("123", 15)).toBe(123n);
    for (const invalid of ["0", "-1", "1.2", "NaN", "9223372036854775808"]) expect(() => fundingAmount(invalid, 15)).toThrow();
  });
  it("commits the source marker before funding and reuses a confirmed operation without another transfer", async () => {
    const demo = funding();
    expect(await fundAgent(demo.options)).toMatchObject({ status: "SUCCESS", hash: cleanHash });
    expect(demo.chain.fundEscrow).toHaveBeenCalledWith(demo.treasury, "a".repeat(64), 1_333_334n);
    expect([...demo.rows.values()][0]).toMatchObject({ status: "completed", fundTxHash: cleanHash });
    expect(await fundAgent(demo.options)).toMatchObject({ status: "SUCCESS", hash: cleanHash, reused: true });
    expect(demo.chain.fundEscrow).toHaveBeenCalledTimes(1);
  });
  it("keeps an unknown transfer pending and blocks later source work", async () => {
    const demo = funding(); demo.chain.fundEscrow.mockRejectedValue(new Error("private network details"));
    expect(await fundAgent(demo.options)).toMatchObject({ status: "PENDING" });
    expect([...demo.rows.values()][0].status).toBe("funding");
    await expect(fundAgent({ ...demo.options, operationKey: "second" })).rejects.toThrow(/reconcil|pending/i);
    expect(demo.chain.fundEscrow).toHaveBeenCalledTimes(1);
  });
  it("does not report a failed or hashless transfer as completed", async () => {
    const demo = funding(); demo.chain.fundEscrow.mockResolvedValue({ status: "SUCCESS", hash: "", innerHash: "", transport: "relayer" });
    expect(await fundAgent(demo.options)).toMatchObject({ status: "PENDING" });
    expect([...demo.rows.values()][0].status).toBe("funding");
    expect(demo.tx.agent.update).not.toHaveBeenCalled();
  });
  it("refuses to fund inactive agents or a different on-chain identity", async () => {
    const demo = funding(); demo.tx.agent.findUnique.mockResolvedValueOnce(null);
    await expect(fundAgent(demo.options)).rejects.toThrow(/agent/i);
    demo.chain.getPolicy.mockResolvedValueOnce({ owner: "GOTHER", agent: "GOTHER", asset: TESTNET_XLM, maxAmount: 10n, expiresAt: 0n });
    await expect(fundAgent(demo.options)).rejects.toThrow(/policy|identity/i);
    expect(demo.chain.fundEscrow).not.toHaveBeenCalled();
  });
});

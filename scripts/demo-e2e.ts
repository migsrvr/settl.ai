import { loadEnvConfig } from "@next/env";
import { createStellarClient, loadStellarConfig, TESTNET_XLM, type NoirClient } from "@settl/stellar";
import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { connectMcp, mcpUrl, type McpConnection } from "../apps/agent/src/client";
import { Ledger, type Operation } from "../apps/agent/src/ledger";
import { createLogger } from "../apps/agent/src/log";

class DemoError extends Error {}
type Row = Record<string, unknown>;
interface DemoOptions {
  connection: McpConnection;
  proof: Pick<NoirClient, "readAuthorizeTx">;
  ledger: Pick<Ledger, "load" | "operation" | "saveOperation">;
  output: (line: string) => void;
  pause: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  endpoint: string;
  approvalTimeoutMs?: number;
}
function requireDemo(ok: unknown, message: string): asserts ok { if (!ok) throw new DemoError(message); }
function row(value: unknown): Row {
  requireDemo(value && typeof value === "object" && !Array.isArray(value), "Malformed live response; reconcile recorded calls");
  return value as Row;
}
function integer(value: unknown): bigint {
  requireDemo(typeof value === "string" && /^\d+$/.test(value), "Malformed live monetary amount");
  return BigInt(value);
}
function text(value: unknown): string {
  return [...String(value ?? "")].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("").slice(0, 300);
}
const keys = ["demo:clean", "demo:blurry", "demo:pro", "demo:geoph"];

/** A deterministic driver of real MCP tools; no synthetic runtime receipts or payments. */
export async function runLiveDemo(options: DemoOptions): Promise<void> {
  const { connection, proof, ledger, output, pause, sleep, now } = options;
  const timeout = options.approvalTimeoutMs ?? 180_000;
  requireDemo(Number.isFinite(timeout) && timeout >= 3000 && timeout <= 300_000, "Approval timeout must be 3–300 seconds");
  const endpoint = mcpUrl(options.endpoint);
  const buyerUrl = (path: string) => new URL(path, endpoint).href;
  await ledger.load();
  requireDemo(keys.every((key) => !ledger.operation(key)), "Demo operations already recorded. Reconcile them before deliberately choosing a fresh journal.");
  const heading = async (title: string) => { output(`\n\u001b[36m${title}\u001b[0m`); await pause(); };
  const budget = async () => {
    const value = await connection.callTool("settl_get_budget", {});
    return { raw: value, balance: integer(value.balanceStroops), spent: integer(value.spentTodayStroops), held: integer(value.heldStroops) };
  };
  const checkBalance = async (before: Awaited<ReturnType<typeof budget>>, charge: bigint) => {
    const after = await budget();
    requireDemo(after.balance === before.balance - charge && after.spent === before.spent + charge && after.held === before.held,
      "Observed balance, daily spend or held amount differs from the expected charge; reconcile before continuing");
    return after;
  };
  const call = async (key: string, args: Row, resume = false) => {
    const requestFingerprint = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const prior = ledger.operation(key);
    requireDemo(!prior || (resume && prior.status === "approval_required" && !prior.resumeAttempted), "Recorded call cannot be replayed; reconcile first");
    await ledger.saveOperation(key, { status: "submitted", requestFingerprint, ...(resume ? { resumeAttempted: true, approvalId: String(args.approvalId) } : {}) });
    let result: Row;
    try { result = await connection.callTool("settl_call", args); }
    catch {
      await ledger.saveOperation(key, { status: "unknown", requestFingerprint, ...(resume ? { resumeAttempted: true, approvalId: String(args.approvalId) } : {}) });
      throw new DemoError("Tool delivery is uncertain. Reconcile the journal and live audit trail; do not repeat the call.");
    }
    const statuses: Operation["status"][] = ["paid", "not_charged", "declined", "blocked", "approval_required", "pending"];
    const status = statuses.includes(result.status as Operation["status"]) ? result.status as Operation["status"] : "unknown";
    const receipt = result.receipt && typeof result.receipt === "object" ? row(result.receipt) : {};
    const quoteId = receipt.quoteId ?? result.quoteId;
    const txHash = receipt.txHash ?? result.txHash;
    await ledger.saveOperation(key, { status, requestFingerprint, ...(resume ? { resumeAttempted: true } : {}),
      ...(typeof result.approvalId === "string" ? { approvalId: result.approvalId } : {}),
      ...(typeof quoteId === "string" ? { quoteId } : {}),
      ...(typeof txHash === "string" && /^[a-fA-F0-9]{64}$/.test(txHash) ? { txHash } : {}),
    });
    requireDemo(status !== "pending" && status !== "unknown", "Payment is pending or unknown; reconcile before continuing");
    return result;
  };
  const paid = async (result: Row, amount: bigint) => {
    requireDemo(result.status === "paid", "Expected a settled payment; inspect the live audit trail");
    const receipt = row(result.receipt);
    requireDemo(receipt.status === "paid" && integer(receipt.amountStroops) === amount && typeof receipt.quoteId === "string", "Paid receipt amount or identity is invalid");
    requireDemo(typeof receipt.txHash === "string" && /^[a-fA-F0-9]{64}$/.test(receipt.txHash), "Paid receipt lacks a real transaction hash");
    requireDemo(Array.isArray(receipt.checks) && receipt.checks.every((check) => row(check).ok === true), "Paid receipt verification did not pass");
    requireDemo(result.data && typeof result.data === "object", "Provider returned no result");
    const evidence = await proof.readAuthorizeTx(receipt.txHash);
    requireDemo(evidence.ok && evidence.args?.amount === amount && evidence.args.asset === TESTNET_XLM, "Confirmed ledger authorization evidence does not match the receipt");
    output(`PAID — ${amount} stroops; quote ${text(receipt.quoteId)}`);
    output(`https://stellar.expert/explorer/testnet/tx/${receipt.txHash}`);
    return receipt;
  };

  await heading("Step 1 — Discover live paid services");
  const discovery = await connection.callTool("settl_list_services", {});
  requireDemo(Array.isArray(discovery.services), "No live services returned");
  const services = discovery.services.map(row);
  const service = (id: string, providerId: string, mode: string, php: string) => {
    const value = services.find((item) => item.id === id);
    requireDemo(value && value.providerId === providerId && value.mode === mode && row(value.displayPrice).currency === "PHP" && row(value.displayPrice).amount === php,
      `Live service ${id} differs from the approved demo setup`);
    return integer(value.amountStroops);
  };
  const cleanPrice = service("resibo_parse", "resibo", "per_call", "2.00");
  const proPrice = service("resibo_pro", "resibo", "per_call", "15.00");
  const geoPrice = service("geoph_lookup", "geoph", "per_call", "8.00");
  for (const item of services) output(`${text(item.id)} — PHP ${text(row(item.displayPrice).amount)} — ${text(item.mode)}`);

  await heading("Step 2 — Read live escrow and guardrails");
  let snapshot = await budget();
  const policy = row(snapshot.raw.policy);
  requireDemo(policy.asset === TESTNET_XLM && snapshot.balance >= 2n * cleanPrice + geoPrice && snapshot.held === 0n &&
    integer(snapshot.raw.remainingDailyBudgetStroops) >= 2n * cleanPrice + geoPrice && Number(snapshot.raw.openApprovals) === 0,
    "Agent needs sufficient native-XLM escrow, daily budget, and no outstanding holds or approvals");
  requireDemo(integer(policy.autoApproveUpTo) >= cleanPrice && integer(policy.autoApproveUpTo) < geoPrice &&
    integer(policy.maxAmount) >= geoPrice && integer(policy.maxPricePerCall) >= geoPrice && integer(policy.maxPricePerCall) < proPrice &&
    Array.isArray(policy.allowlist) && ["resibo", "geoph"].every((id) => (policy.allowlist as unknown[]).includes(id)) &&
    Date.parse(String(policy.expiresAt)) > now(), "Agent policy does not match the clean/declined/approval demonstration");
  output(`Escrow: ${snapshot.balance} stroops (PHP ${text(snapshot.raw.balancePhp)}); daily limit: ${text(policy.dailyBudget)} stroops; automatic approval: ${text(policy.autoApproveUpTo)} stroops`);

  await heading("Step 3 — Usage billing: clean mock receipt");
  const clean = await call(keys[0], { serviceId: "resibo_parse", input: { fixture: "clean" }, maxPricePhp: "10.00" });
  const cleanReceipt = await paid(clean, cleanPrice);
  output("API usage charged; the mock provider returned a clean receipt.");
  snapshot = await checkBalance(snapshot, cleanPrice);

  await heading("Step 4 — Usage billing: blurry mock receipt");
  const blurry = await call(keys[1], { serviceId: "resibo_parse", input: { fixture: "blurry" }, maxPricePhp: "10.00" });
  const blurryReceipt = await paid(blurry, cleanPrice);
  snapshot = await checkBalance(snapshot, cleanPrice);
  output("API usage charged at the same price; mock receipt quality does not determine the fee.");

  await heading("Step 5 — Caller price protection: PHP15 exceeds PHP10");
  const pro = await call(keys[2], { serviceId: "resibo_pro", maxPricePhp: "10.00" });
  requireDemo(pro.status === "declined" && pro.reason === "over_max_price", "Expected over_max_price decline");
  snapshot = await checkBalance(snapshot, 0n);
  output("DECLINED — over_max_price. Off-chain caller price protection; no payment gas spent.");

  await heading("Step 6 — Human approval, then real settlement");
  const geoArgs = { serviceId: "geoph_lookup", input: { city: "Makati" }, maxPricePhp: "10.00" };
  const geo = await call(keys[3], geoArgs);
  requireDemo(geo.status === "approval_required" && typeof geo.approvalId === "string" && geo.approvalId.length > 0, "Expected a human approval request");
  snapshot = await checkBalance(snapshot, 0n);
  output(`Approve as this agent's buyer: ${buyerUrl(`/buyer/approvals/${encodeURIComponent(geo.approvalId)}`)}`);
  const deadline = now() + timeout;
  let approved = false;
  while (now() < deadline) {
    const approval = row((await connection.callTool("settl_check_approval", { approvalId: geo.approvalId })).approval);
    requireDemo(approval.id === geo.approvalId && approval.providerId === "geoph" && integer(approval.amountStroops) === geoPrice, "Approval does not match this request");
    const status = approval.status;
    requireDemo(["pending", "approved", "declined", "expired"].includes(String(status)), "Unknown approval status");
    const expiresAt = Date.parse(String(approval.expiresAt));
    requireDemo(Number.isFinite(expiresAt), "Invalid approval expiry; no payment resumed");
    if (status === "declined" || status === "expired" || expiresAt <= now()) {
      await ledger.saveOperation(keys[3], { ...ledger.operation(keys[3])!, approvalStatus: status === "declined" ? "declined" : "expired" });
      throw new DemoError("Approval declined or expired; no payment resumed");
    }
    if (status === "approved") { approved = true; break; }
    output(`Waiting for buyer approval — ${Math.ceil((deadline - now()) / 1000)}s remaining`);
    await sleep(Math.min(3000, deadline - now()));
  }
  if (!approved) {
    await ledger.saveOperation(keys[3], { ...ledger.operation(keys[3])!, approvalStatus: "timed_out" });
    throw new DemoError("Approval timed out. Reconcile the existing approval; no second request was created.");
  }
  const geoPaid = await call(keys[3], { ...geoArgs, approvalId: geo.approvalId }, true);
  const geoReceipt = await paid(geoPaid, geoPrice);
  await checkBalance(snapshot, geoPrice);
  const audit = await connection.callTool("settl_receipts", { limit: 20 });
  requireDemo(Array.isArray(audit.receipts), "Live audit records unavailable");
  for (const receipt of [cleanReceipt, blurryReceipt, geoReceipt]) {
    requireDemo(audit.receipts.some((item) => {
      const entry = row(item);
      return entry.quoteId === receipt.quoteId && entry.status === receipt.status && entry.amountStroops === receipt.amountStroops && entry.txHash === receipt.txHash;
    }), "Live audit trail does not match the demonstrated receipt");
  }
  output(`Live audit records confirmed. Buyer activity: ${buyerUrl("/buyer")}`);
  output(`Provider payout is a separate live action: ${buyerUrl("/provider/earnings")}`);
  output("Switch to ResiboAI and GeoPH, claim earnings, and record each real claim hash. This agent token cannot claim provider funds.");
}

async function main() {
  loadEnvConfig(resolve("apps/web"));
  const token = process.env.DEMO_AGENT_API_KEY ?? "stl_agent_bookkeeper_demo";
  const log = createLogger([token, process.env.VELO_API_KEY ?? "", process.env.VELO_GAS_API_KEY ?? "", process.env.DATABASE_URL ?? "", process.env.SETTL_TREASURY_SECRET ?? ""]);
  const ledger = new Ledger(resolve(process.env.SETTL_DEMO_LEDGER_PATH ?? "apps/agent/.data/live-demo.json"));
  let unlock: (() => Promise<void>) | undefined;
  let connection: McpConnection | undefined;
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !process.argv.includes("--no-pause");
  const terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  try {
    if (process.argv.includes("--reset")) {
      await unlink(ledger.path).catch(() => {});
      await unlink(`${ledger.path}.lock`).catch(() => {});
    }
    unlock = await ledger.lock();
    const config = loadStellarConfig();
    connection = await connectMcp(process.env.SETTL_MCP_URL ?? "http://localhost:3000/mcp", token);
    log("info", "Live MCP driver. Receipt OCR uses deterministic provider fixtures; network, verification, payments and records are real.");
    await runLiveDemo({ connection, proof: createStellarClient(config), ledger,
      endpoint: process.env.SETTL_MCP_URL ?? "http://localhost:3000/mcp", output: (line) => log("info", line),
      pause: async () => { if (terminal) await terminal.question("Press Enter to continue… "); },
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)), now: Date.now,
    });
  } catch (error) {
    const message = error instanceof DemoError ? error.message : error instanceof Error ? error.message : "Demo stopped. Check configuration, provider connectivity and the recorded operations before retrying.";
    log("error", message);
    if (!process.argv.includes("--reset") && message.includes("Demo operations already recorded")) {
      log("info", "To start a fresh live demonstration run, pass --reset: npx tsx scripts/demo-e2e.ts --reset");
    }
    process.exitCode = 1;
  } finally {
    terminal?.close();
    try { await connection?.close(); } finally { await unlock?.(); }
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/demo-e2e.ts")) {
  main().catch(() => { console.error("Demo cleanup failed; inspect the journal and lock before another run."); process.exitCode = 1; });
}

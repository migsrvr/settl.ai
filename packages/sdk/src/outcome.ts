import { HEADER_RECEIPT, ReceiptSchema } from "@settl/core";
import type { PaymentHeader } from "@settl/core";
import type { NextFunction, Request, Response } from "express";
import { postJson } from "./settlApi";

type Commit = Extract<PaymentHeader, { kind: "commit" }>;
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Outcome providers send JSON; output stays buffered until settlement is known. */
export async function handleCommit(req: Request, res: Response, next: NextFunction, proof: Commit, endpointId: string, apiUrl: string, headers: Record<string, string>): Promise<void> {
  const identity = { quoteId: proof.quoteId, reservationId: proof.reservationId, endpointId };
  let preflight: unknown;
  try { preflight = await postJson(`${apiUrl}/api/verify`, { ...identity, checkOnly: true }, headers); }
  catch { res.status(502).json({ error: "Payment service unavailable" }); return; }
  if (!object(preflight) || preflight.ok !== true || preflight.quoteId !== proof.quoteId || preflight.reservationId !== proof.reservationId) {
    res.status(402).json({ error: object(preflight) && typeof preflight.error === "string" && preflight.error ? preflight.error : "Invalid payment commitment" });
    return;
  }
  const sendJson = res.json.bind(res);
  let sent = false;
  let completed!: () => void;
  const completion = new Promise<void>((resolve) => { completed = resolve; });
  const sendError = (message: string) => {
    res.json = sendJson;
    if (!res.headersSent && !res.writableEnded) {
      try { res.status(502); sendJson({ error: message }); } catch { /* The client may already be gone. */ }
    }
  };
  const deadline = setTimeout(() => {
    if (sent) return;
    sent = true; sendError("Provider result unavailable"); completed();
  }, 125_000);
  res.json = ((body: unknown) => {
    if (sent) return res;
    sent = true;
    void (async () => {
      try {
        // Verify and deliver the same immutable JSON snapshot.
        const result: unknown = JSON.parse(JSON.stringify(body));
        const settlement = await postJson(`${apiUrl}/api/verify`, { ...identity, result }, headers, 120_000);
        if (!object(settlement) || !["pass", "fail"].includes(String(settlement.verification))) throw new Error("Settlement unresolved");
        const receipt = ReceiptSchema.parse(settlement.receipt);
        if (receipt.quoteId !== proof.quoteId || settlement.verification === "pass" && (receipt.status !== "paid" || !/^[a-f0-9]{64}$/.test(receipt.txHash ?? "")) || settlement.verification === "fail" && (receipt.status !== "not_charged" || receipt.amountStroops !== "0")) throw new Error("Settlement mismatch");
        req.settlReceipt = receipt;
        res.setHeader(HEADER_RECEIPT, Buffer.from(JSON.stringify(receipt), "utf8").toString("base64"));
        res.json = sendJson;
        sendJson(result);
      } catch {
        sendError("Payment service unavailable");
      } finally { clearTimeout(deadline); completed(); }
    })();
    return res;
  }) as Response["json"];
  try { next(); }
  catch (error) { clearTimeout(deadline); res.json = sendJson; throw error; }
  await completion;
}

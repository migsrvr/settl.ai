import type { NextFunction, Request, Response } from "express";
import { HEADER_RECEIPT, receiptHeaderValue, settleOutcome, type Gateway, type OutcomeIdentity } from "./core";

/** Outcome providers send JSON; output stays buffered until settlement is known. The reservation is already confirmed. */
export async function handleCommit(req: Request, res: Response, next: NextFunction, gateway: Gateway, identity: OutcomeIdentity): Promise<void> {
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
        const receipt = await settleOutcome(gateway, identity, result);
        req.settlReceipt = receipt;
        res.setHeader(HEADER_RECEIPT, receiptHeaderValue(receipt));
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

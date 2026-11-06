import {
  decodePaymentHeader,
  HEADER_PAYMENT,
  HEADER_RECEIPT,
  QuoteSchema,
  ReceiptSchema,
  type PaymentHeader,
  type Receipt,
} from "@settl/core";
import type { RequestHandler } from "express";
import { postJson, serviceUrl } from "./settlApi";
import { handleCommit } from "./outcome";

export interface SettlOptions {
  endpointId: string;
  apiUrl?: string;
  apiKey?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    settlReceipt?: Receipt;
  }
}

const unavailable = { error: "Payment service unavailable" };

/** Gate an Express handler on a verified, endpoint-bound per-call payment. */
export function settl(opts: SettlOptions): RequestHandler {
  if (typeof opts.endpointId !== "string" || !opts.endpointId.trim()) {
    throw new Error("endpointId must be a non-empty string");
  }
  const endpointId = opts.endpointId;
  const apiUrl = serviceUrl(opts.apiUrl ?? (process.env.SETTL_API_URL || "http://localhost:3000"));
  const apiKey = opts.apiKey ?? process.env.SETTL_PROVIDER_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return async (req, res, next) => {
    const raw = req.headers[HEADER_PAYMENT.toLowerCase()];
    if (raw === undefined) {
      let quote;
      try {
        quote = QuoteSchema.parse(await postJson(`${apiUrl}/api/quotes`, { endpointId }, headers));
      } catch {
        res.status(502).json(unavailable);
        return;
      }
      res.status(402).json(quote);
      return;
    }

    let proof: PaymentHeader;
    try {
      if (typeof raw !== "string") throw new Error("Invalid payment header");
      proof = decodePaymentHeader(raw);
    } catch {
      res.status(400).json({ error: "Invalid payment header" });
      return;
    }
    if (proof.kind === "commit") {
      await handleCommit(req, res, next, proof, endpointId, apiUrl, headers);
      return;
    }

    let receipt: Receipt | null;
    let paymentError = "Payment verification failed";
    try {
      const result = await postJson(`${apiUrl}/api/payments/verify`, { proof, endpointId }, headers);
      if (typeof result !== "object" || result === null || !("ok" in result)) {
        throw new Error("Invalid verification response");
      }
      if (result.ok === false) {
        receipt = null;
        if ("error" in result && typeof result.error === "string" && result.error.trim()) {
          paymentError = result.error;
        }
      } else {
        if (result.ok !== true || !("receipt" in result)) throw new Error("Invalid verification response");
        receipt = ReceiptSchema.parse(result.receipt);
        if (receipt.status !== "paid" || receipt.quoteId !== proof.quoteId || receipt.txHash !== proof.txHash) {
          throw new Error("Invalid verification receipt");
        }
      }
    } catch {
      res.status(502).json(unavailable);
      return;
    }
    if (receipt === null) {
      res.status(402).json({ error: paymentError });
      return;
    }

    res.setHeader(HEADER_RECEIPT, Buffer.from(JSON.stringify(receipt), "utf8").toString("base64"));
    req.settlReceipt = receipt;
    // Downstream handler failures belong to Express, outside payment error handling.
    next();
  };
}


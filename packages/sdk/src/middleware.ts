import { HEADER_PAYMENT, type Receipt } from "@settl/core";
import type { RequestHandler } from "express";
import { createGateway, gate, HEADER_RECEIPT, receiptHeaderValue, type SettlOptions } from "./core";
import { handleCommit } from "./outcome";

export type { SettlOptions } from "./core";

declare module "express-serve-static-core" {
  interface Request {
    settlReceipt?: Receipt;
  }
}

/** An Express middleware that can also register its endpoint ahead of the first request. */
export type SettlMiddleware = RequestHandler & {
  /** Register now (when described in code) and resolve to the endpoint id. Registration is otherwise lazy. */
  register(): Promise<string>;
};

/** Gate an Express handler on a verified, endpoint-bound per-call payment. */
export function settl(opts: SettlOptions): SettlMiddleware {
  const gateway = createGateway(opts);

  const middleware: RequestHandler = async (req, res, next) => {
    const decision = await gate(gateway, req.headers[HEADER_PAYMENT.toLowerCase()]);
    if (decision.action === "reply") {
      res.status(decision.status).json(decision.body);
      return;
    }
    if (decision.action === "commit") {
      await handleCommit(req, res, next, gateway, decision.identity);
      return;
    }
    res.setHeader(HEADER_RECEIPT, receiptHeaderValue(decision.receipt));
    req.settlReceipt = decision.receipt;
    // Downstream handler failures belong to Express, outside payment error handling.
    next();
  };
  return Object.assign(middleware, { register: () => gateway.endpointId() });
}

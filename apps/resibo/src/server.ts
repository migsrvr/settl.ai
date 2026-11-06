import { pathToFileURL } from "node:url";
import { settl } from "@settl/sdk";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { geographySample, receiptFixtures, type ReceiptFixture } from "./fixtures.js";

export interface ResiboOptions {
  apiUrl?: string;
  apiKey?: string;
}

const validateObject: RequestHandler = (req, res, next) => {
  const body: unknown = req.body;
  if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body))) {
    res.status(400).json({ error: "invalid_body", message: "Expected a JSON object." });
    return;
  }
  next();
};

const validateReceipt: RequestHandler = (req, res, next) => {
  const body: unknown = req.body;
  const fixture = body && typeof body === "object" && "fixture" in body ? body.fixture : undefined;
  if (
    fixture !== undefined &&
    (typeof fixture !== "string" || !Object.prototype.hasOwnProperty.call(receiptFixtures, fixture))
  ) {
    res.status(400).json({
      error: "invalid_fixture",
      message: "fixture must be clean, blurry, or wrong_total.",
    });
    return;
  }
  res.locals.receiptFixture = fixture ?? "clean";
  next();
};

const sendReceipt: RequestHandler = (_req, res) => {
  const fixture = res.locals.receiptFixture as ReceiptFixture;
  res.json(receiptFixtures[fixture]);
};

const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
  if (type === "entity.too.large") {
    res.status(413).json({ error: "request_too_large" });
    return;
  }
  if (type === "entity.parse.failed" || error instanceof SyntaxError) {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  if (type === "request.aborted" || type === "request.size.invalid") {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  res.status(500).json({ error: "internal_error" });
};

export function createApp(options: ResiboOptions = {}) {
  const app = express();
  const paymentOptions = {
    apiUrl: options.apiUrl ?? (process.env.SETTL_API_URL || "http://localhost:3000"),
    apiKey: options.apiKey ?? process.env.SETTL_PROVIDER_KEY,
  };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.post(
    "/parse-receipt",
    validateObject,
    validateReceipt,
    settl({ endpointId: "resibo_parse", ...paymentOptions }),
    sendReceipt,
  );
  app.post(
    "/parse-receipt-pro",
    validateObject,
    validateReceipt,
    settl({ endpointId: "resibo_pro", ...paymentOptions }),
    sendReceipt,
  );
  app.post(
    "/lookup",
    validateObject,
    settl({ endpointId: "geoph_lookup", ...paymentOptions }),
    (_req, res) => {
      res.json(geographySample);
    },
  );

  app.use(handleError);
  return app;
}

export const app = createApp();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  app.listen(port);
}

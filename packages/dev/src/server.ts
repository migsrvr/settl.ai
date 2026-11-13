import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { phpToStroops } from "@settl/core";
import { POST as handleMcp } from "../../../apps/web/app/mcp/route";
import type { PrismaClient } from "../../../apps/web/lib/generated/prisma/client";
import { ApiError, apiErrorResponse, jsonResponse, readObjectBody } from "../../../apps/web/lib/server/api-auth";
import { resolveApproval } from "../../../apps/web/lib/server/approval-resolution";
import { setChain } from "../../../apps/web/lib/server/chain";
import { setDb } from "../../../apps/web/lib/server/db";
import { handleAiCatalog, handleDiscoveryOptions, handleLlmsTxt, handleServerCard } from "../../../apps/web/lib/server/discovery";
import { handleAgentCall } from "../../../apps/web/lib/server/handlers/agent-call";
import { handlePaymentsVerify } from "../../../apps/web/lib/server/handlers/payments-verify";
import { handleRegister } from "../../../apps/web/lib/server/handlers/register";
import { handleQuotes } from "../../../apps/web/lib/server/handlers/quotes";
import { handleVerify } from "../../../apps/web/lib/server/handlers/verify";
import { startSandboxDatabase } from "./database";
import { FakeChain } from "./fake-chain";
import { allowProvider, seedSandbox } from "./seed";

export interface SandboxOptions {
  /** Gateway port. 0 picks a free port. Default 4000. */
  port?: number;
  host?: string;
  /** Origin serving the provider routes the demo services point at. Default http://localhost:3001. */
  providerUrl?: string;
  /** Credential providers send with SETTL_PROVIDER_KEY. */
  providerKey?: string;
  /** Bearer key for the demo agent; must start with stl_agent_. */
  agentKey?: string;
  /** Fake escrow for the demo agent, in pesos. Default 100. */
  balancePhp?: number;
  /** Let the demo agent spend its whole daily budget without asking a human. */
  autoApprove?: boolean;
  phpPerXlm?: number;
  /** Kept for callers that print their own banner; the library itself never logs. */
  quiet?: boolean;
}

export interface Sandbox {
  url: string;
  mcpUrl: string;
  providerKey: string;
  agentKey: string;
  providerUrl: string;
  chain: FakeChain;
  prisma: PrismaClient;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  if (req.method === "GET" || req.method === "HEAD") return new Request(url, { method: req.method, headers });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "request_too_large");
    chunks.push(chunk as Buffer);
  }
  return new Request(url, { method: req.method, headers, body: Buffer.concat(chunks) });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  res.writeHead(response.status, headers);
  if (!response.body) { res.end(); return; }
  // Stream so MCP server-sent events reach the client as they are produced.
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  res.on("close", () => body.destroy());
  body.on("error", () => res.end());
  body.pipe(res);
}

// The broker reads its database and chain from process-wide seams, so only one sandbox fits per process.
let running = false;

export async function startSandbox(options: SandboxOptions = {}): Promise<Sandbox> {
  if (running) throw new Error("A sandbox is already running in this process. Close it before starting another.");
  running = true;
  const cleanups: Array<() => Promise<void> | void> = [];
  const teardown = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    running = false;
  };
  try {
    return await boot(options, cleanups, teardown);
  } catch (error) {
    // A failed start (for example a taken port) must not leave a database holding the process open.
    await teardown();
    throw error;
  }
}

async function boot(options: SandboxOptions, cleanups: Array<() => Promise<void> | void>, teardown: () => Promise<void>): Promise<Sandbox> {
  const phpPerXlm = options.phpPerXlm ?? 15;
  const providerKey = options.providerKey ?? "sandbox_provider_key";
  const agentKey = options.agentKey ?? "stl_agent_sandbox_demo";
  const providerUrl = (options.providerUrl ?? "http://localhost:3001").replace(/\/+$/, "");
  const host = options.host ?? "127.0.0.1";

  const previousEnv = { SETTL_PROVIDER_KEY: process.env.SETTL_PROVIDER_KEY, PHP_PER_XLM: process.env.PHP_PER_XLM };
  process.env.SETTL_PROVIDER_KEY = providerKey;
  process.env.PHP_PER_XLM = String(phpPerXlm);
  cleanups.push(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  const database = await startSandboxDatabase();
  cleanups.push(() => database.close());
  const chain = new FakeChain();
  setDb(database.prisma);
  setChain({ chain, escrowContract: "SANDBOX_ESCROW" });
  cleanups.push(() => { setChain(undefined); setDb(undefined); });
  await seedSandbox(database.prisma, {
    chain, agentKey, providerUrl, phpPerXlm,
    balanceStroops: phpToStroops(options.balancePhp ?? 100, phpPerXlm),
  });
  if (options.autoApprove) {
    const policies = await database.prisma.policy.findMany({ select: { agentId: true, dailyBudget: true } });
    for (const policy of policies) {
      await database.prisma.policy.update({ where: { agentId: policy.agentId }, data: { autoApproveUpTo: policy.dailyBudget } });
    }
  }

  let origin = "";
  const route = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const method = request.method;
    if (method === "GET" && pathname === "/health") return jsonResponse({ ok: true });
    if (method === "GET" && pathname === "/") {
      return jsonResponse({
        sandbox: true,
        note: "Fake money on a fake chain. Nothing here touches Stellar, Velo or a real database.",
        mcpUrl: `${origin}/mcp`,
        apiUrl: origin,
        endpoints: ["GET /llms.txt", "GET /mcp/server-card", "GET /.well-known/ai-catalog.json", "POST /api/quotes", "POST /api/payments/verify", "POST /api/verify", "POST /api/agent/call", "POST /api/approvals/:id/resolve", "/mcp"],
      });
    }
    if (pathname === "/mcp/server-card" || pathname === "/.well-known/ai-catalog.json") {
      if (method === "OPTIONS") return handleDiscoveryOptions();
      if (method === "GET") return pathname === "/mcp/server-card" ? handleServerCard(request) : handleAiCatalog(request);
    }
    if (method === "GET" && pathname === "/llms.txt") return handleLlmsTxt(request);
    if (pathname === "/mcp") return handleMcp(request);
    if (method === "POST" && pathname === "/api/quotes") return handleQuotes(request);
    if (method === "POST" && pathname === "/api/payments/verify") return handlePaymentsVerify(request);
    if (method === "POST" && pathname === "/api/verify") return handleVerify(request);
    if (method === "POST" && pathname === "/api/agent/call") return handleAgentCall(request);
    if (method === "POST" && pathname === "/api/provider/register") {
      let providerId: unknown;
      try { providerId = ((await request.clone().json()) as { providerId?: unknown }).providerId; } catch { /* the handler rejects bad bodies */ }
      const response = await handleRegister(request, { sandbox: true });
      // A provider that just appeared must be buyable: let the demo agent spend with it.
      if (response.ok && typeof providerId === "string") await allowProvider(database.prisma, providerId);
      return response;
    }
    const approval = /^\/api\/approvals\/([^/]+)\/resolve$/.exec(pathname);
    if (method === "POST" && approval) {
      try {
        // Sandbox stands in for the human: no login, localhost only. Production requires the buyer's session.
        const body = await readObjectBody(request);
        if (body.decision !== "approved" && body.decision !== "declined") throw new ApiError(400, "invalid_decision");
        const id = decodeURIComponent(approval[1]);
        const found = await database.prisma.approval.findUnique({ where: { id }, include: { agent: true } });
        if (!found) throw new ApiError(404, "approval_not_found");
        return jsonResponse(await resolveApproval(database.prisma, { id, decision: body.decision, orgId: found.agent.orgId }));
      } catch (error) {
        return apiErrorResponse(error);
      }
    }
    return jsonResponse({ error: "not_found" }, 404);
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        await send(res, await route(await toRequest(req)));
      } catch (error) {
        if (!res.headersSent) await send(res, apiErrorResponse(error));
        else res.end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4000, host, resolve);
  });
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const port = (server.address() as AddressInfo).port;
  origin = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

  return {
    url: origin, mcpUrl: `${origin}/mcp`, providerKey, agentKey, providerUrl, chain, prisma: database.prisma,
    close: teardown,
  };
}

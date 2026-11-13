import { parseArgs } from "node:util";

export interface CliOptions {
  port: number;
  providerUrl: string;
  providerKey: string | undefined;
  agentKey: string | undefined;
  balancePhp: number;
  autoApprove: boolean;
  help: boolean;
}

export const USAGE = `settl-dev: a local Settl gateway with fake money

Usage: settl-dev [options]

  --port <n>             Gateway port (default 4000)
  --provider-url <url>   Origin your provider listens on (default http://localhost:3001)
  --balance <php>        Fake escrow for the demo agent, in pesos (default 100)
  --auto-approve         Let the agent spend its daily budget without asking a human
  --provider-key <key>   Credential providers send (default sandbox_provider_key)
  --agent-key <key>      Bearer key for the demo agent, starting with stl_agent_
  -h, --help             Show this help
`;

/** A message for the terminal when the sandbox cannot start. This is local tooling, so it states the real cause. */
export function describeStartupError(error: unknown): string {
  const reason = error instanceof Error ? error.message.split("\n")[0] : "";
  if (/EADDRINUSE/.test(reason)) return "That port is already in use. Pick another with --port.";
  const hint = /prisma|generated/i.test(reason) ? " Run `npm run db:generate -w web` once, then try again." : "";
  return `The sandbox could not start${reason ? `: ${reason}` : "."}${hint}`;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      "provider-url": { type: "string" },
      balance: { type: "string" },
      "auto-approve": { type: "boolean", default: false },
      "provider-key": { type: "string" },
      "agent-key": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const port = values.port === undefined ? 4000 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a whole number from 0 to 65535");

  const balancePhp = values.balance === undefined ? 100 : Number(values.balance);
  if (!Number.isFinite(balancePhp) || balancePhp < 0) throw new Error("--balance must be a peso amount of 0 or more, for example 100");

  let providerUrl = "http://localhost:3001";
  if (values["provider-url"] !== undefined) {
    try {
      const url = new URL(values["provider-url"]);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
      providerUrl = url.origin;
    } catch {
      throw new Error("--provider-url must be an http(s) origin such as http://localhost:3001");
    }
  }

  const agentKey = values["agent-key"];
  if (agentKey !== undefined && (!agentKey.startsWith("stl_agent_") || agentKey.length <= "stl_agent_".length)) {
    throw new Error("--agent-key must start with stl_agent_ and have a suffix");
  }

  return {
    port, providerUrl, balancePhp, agentKey, help: values.help ?? false,
    providerKey: values["provider-key"],
    autoApprove: values["auto-approve"] ?? false,
  };
}

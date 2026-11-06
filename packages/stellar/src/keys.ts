import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";

export function deviceHashForAgent(agentId: string): string {
  if (!agentId) throw new Error("Agent ID is required");
  return createHash("sha256").update(`settl:agent:${agentId}`).digest("hex");
}

export async function fundTestnetAccount(publicKey: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) throw new Error("Invalid public account address");
  const url = new URL("https://friendbot.stellar.org/");
  url.searchParams.set("addr", publicKey);
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Friendbot failed (${response.status}); retry account setup`);
}

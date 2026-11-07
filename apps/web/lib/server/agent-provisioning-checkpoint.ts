import type { TxResult } from "@settl/stellar";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export type FinancialStage = "register_device" | "register_policy";
export type Stage = "queued" | "accounts" | FinancialStage | "complete";
export type Entry = TxResult & { stage: FinancialStage };
export interface ProvisioningCheckpoint {
  version: 1;
  operation: "create";
  stage: Stage;
  state: "working" | "pending" | "complete" | "failed";
  updatedAt: string;
  transactions: Entry[];
  lease?: { token: string; expiresAt: string };
  errorCode?: string;
  needsReview?: boolean;
  automaticRecoveryBlocked?: boolean;
}
export function readProvisioningCheckpoint(value: unknown): ProvisioningCheckpoint | null {
  if (!isObject(value) || value.version !== 1 || value.operation !== "create" || !["queued", "accounts", "register_device", "register_policy", "complete"].includes(String(value.stage)) || !["working", "pending", "complete", "failed"].includes(String(value.state)) || !Array.isArray(value.transactions)) return null;
  if (!canonicalDate(value.updatedAt) || (value.automaticRecoveryBlocked !== undefined && typeof value.automaticRecoveryBlocked !== "boolean") || (value.needsReview !== undefined && typeof value.needsReview !== "boolean")) return null;
  if (value.lease !== undefined && (!isObject(value.lease) || typeof value.lease.token !== "string" || !value.lease.token || !canonicalDate(value.lease.expiresAt))) return null;
  if ((value.stage === "complete") !== (value.state === "complete")) return null;
  // Malformed data is never permission to recreate a financial operation.
  if (value.transactions.some((entry) => !isObject(entry) || !["register_device", "register_policy"].includes(String(entry.stage)) || !["SUCCESS", "FAILED", "PENDING"].includes(String(entry.status)) || !/^[a-f0-9]{64}$/.test(String(entry.hash)) || !/^[a-f0-9]{64}$/.test(String(entry.innerHash)) || !["velo", "relayer"].includes(String(entry.transport)) || (entry.recovery !== undefined && (!isObject(entry.recovery) || typeof entry.recovery.requestId !== "string" || entry.recovery.transactionHash !== entry.innerHash)))) return null;
  const transactions = value.transactions as Entry[];
  if (new Set(transactions.map((entry) => entry.stage)).size !== transactions.length) return null;
  const device = transactions.find((entry) => entry.stage === "register_device");
  const policy = transactions.find((entry) => entry.stage === "register_policy");
  if (["queued", "accounts"].includes(String(value.stage)) && transactions.length) return null;
  if ((value.stage === "register_policy" || policy) && device?.status !== "SUCCESS") return null;
  if (value.stage === "register_device" && policy) return null;
  if (value.stage === "complete" && (device?.status !== "SUCCESS" || policy?.status !== "SUCCESS")) return null;
  return value as unknown as ProvisioningCheckpoint;
}

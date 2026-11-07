// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readProvisioningCheckpoint } from "./agent-provisioning-checkpoint";

const queued = { version: 1, operation: "create", stage: "queued", state: "working", updatedAt: "2026-11-07T00:00:00.000Z", transactions: [] };
describe("provisioning checkpoint validation", () => {
  it("accepts queued and blocked checkpoints without importing runtime clients", () => {
    expect(readProvisioningCheckpoint(queued)).toEqual(queued);
    expect(readProvisioningCheckpoint({ ...queued, automaticRecoveryBlocked: true })).toMatchObject({ automaticRecoveryBlocked: true });
  });
  it.each([
    { ...queued, version: undefined },
    { ...queued, version: "1" },
    { ...queued, updatedAt: "invalid" },
    { ...queued, updatedAt: "2026-02-30T00:00:00.000Z" },
    { ...queued, stage: "complete" },
    { ...queued, stage: "register_policy" },
    { ...queued, lease: { token: "lease", expiresAt: "invalid" } },
    { ...queued, lease: { token: "lease", expiresAt: "+010000-01-01T00:00:00.000Z" } },
    { ...queued, lease: { expiresAt: queued.updatedAt } },
  ])("rejects malformed or inconsistent checkpoint %j", (value) => {
    expect(readProvisioningCheckpoint(value)).toBeNull();
  });
});

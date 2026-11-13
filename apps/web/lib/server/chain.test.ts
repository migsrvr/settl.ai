// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const stellar = vi.hoisted(() => ({
  balanceOf: vi.fn(),
  createStellarClient: vi.fn(),
  loadStellarConfig: vi.fn(),
}));

vi.mock("@settl/stellar", () => ({
  loadStellarConfig: stellar.loadStellarConfig,
  createStellarClient: stellar.createStellarClient,
}));

import { getChainOverride, readBalance, setChain } from "./chain";

function fakeChain(balance: bigint) {
  return {
    authorize: vi.fn(),
    readAuthorizeTx: vi.fn(),
    pendingBalance: vi.fn(),
    balanceOf: vi.fn(async () => balance),
  };
}

afterEach(() => {
  setChain(undefined);
  vi.resetAllMocks();
});

describe("chain seam", () => {
  it("reads balances from the configured Stellar client by default", async () => {
    stellar.loadStellarConfig.mockReturnValue({ contracts: {} });
    stellar.balanceOf.mockResolvedValue(42n);
    stellar.createStellarClient.mockReturnValue({ balanceOf: stellar.balanceOf });
    expect(getChainOverride()).toBeUndefined();
    await expect(readBalance("device-1")).resolves.toBe(42n);
    expect(stellar.balanceOf).toHaveBeenCalledWith("device-1");
  });

  it("uses an override without loading Stellar configuration", async () => {
    const chain = fakeChain(7n);
    setChain({ chain, escrowContract: "SANDBOX_ESCROW" });
    expect(getChainOverride()?.escrowContract).toBe("SANDBOX_ESCROW");
    await expect(readBalance("device-2")).resolves.toBe(7n);
    expect(chain.balanceOf).toHaveBeenCalledWith("device-2");
    expect(stellar.loadStellarConfig).not.toHaveBeenCalled();
    expect(stellar.createStellarClient).not.toHaveBeenCalled();
  });

  it("restores the default when the override is cleared", async () => {
    setChain({ chain: fakeChain(1n), escrowContract: "X" });
    setChain(undefined);
    expect(getChainOverride()).toBeUndefined();
    stellar.loadStellarConfig.mockReturnValue({});
    stellar.createStellarClient.mockReturnValue({ balanceOf: async () => 9n });
    await expect(readBalance("device-3")).resolves.toBe(9n);
  });
});

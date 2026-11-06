// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptWalletSecret, encryptWalletSecret } from "./wallets";

const KEY = "11".repeat(32);
const OTHER_KEY = "22".repeat(32);
const SECRET = "test-wallet-secret";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function changeByte(hex: string): string {
  return `${hex.startsWith("00") ? "01" : "00"}${hex.slice(2)}`;
}

describe("custodial wallet encryption", () => {
  it.each([SECRET, "", "wallet secret with Unicode: ₱ 🔐"])("roundtrips a secret", (secret) => {
    const encrypted = encryptWalletSecret(secret, KEY);

    expect(encrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/);
    expect(decryptWalletSecret(encrypted, KEY)).toBe(secret);
    if (secret) expect(encrypted).not.toContain(secret);
  });

  it("uses a new random 12-byte IV for each encryption", () => {
    const first = encryptWalletSecret(SECRET, KEY);
    const second = encryptWalletSecret(SECRET, KEY);

    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
    expect(first).not.toBe(second);
    expect(decryptWalletSecret(first, KEY)).toBe(SECRET);
    expect(decryptWalletSecret(second, KEY)).toBe(SECRET);
  });

  it("reads the default key from WALLET_ENC_KEY", () => {
    vi.stubEnv("WALLET_ENC_KEY", KEY);

    expect(decryptWalletSecret(encryptWalletSecret(SECRET))).toBe(SECRET);
  });

  it("accepts uppercase hexadecimal keys and explicit keys override the environment", () => {
    vi.stubEnv("WALLET_ENC_KEY", OTHER_KEY);
    const key = "ab".repeat(32);

    expect(decryptWalletSecret(encryptWalletSecret(SECRET, key.toUpperCase()), key)).toBe(SECRET);
  });

  it("rejects the wrong key without including secrets in the error", () => {
    const encrypted = encryptWalletSecret(SECRET, KEY);

    expect(() => decryptWalletSecret(encrypted, OTHER_KEY)).toThrow(new Error("Invalid encrypted wallet secret."));
  });

  it.each([1, 2, 3])("rejects a changed IV, authentication tag or ciphertext (part %i)", (index) => {
    const parts = encryptWalletSecret(SECRET, KEY).split(":");
    parts[index] = changeByte(parts[index]);

    expect(() => decryptWalletSecret(parts.join(":"), KEY)).toThrow("Invalid encrypted wallet secret.");
  });

  it.each([
    "",
    "plaintext",
    `v2:${"00".repeat(12)}:${"00".repeat(16)}:00`,
    `v1:${"00".repeat(11)}:${"00".repeat(16)}:00`,
    `v1:${"00".repeat(12)}:${"00".repeat(15)}:00`,
    `v1:${"00".repeat(12)}:${"00".repeat(16)}:0`,
    `v1:${"00".repeat(12)}:${"00".repeat(16)}:zz`,
    `v1:${"AA".repeat(12)}:${"00".repeat(16)}:00`,
    `v1:${"00".repeat(12)}:${"00".repeat(16)}:00:extra`,
    `v1:${"00".repeat(12)}:${"00".repeat(16)}:00\n`,
  ])("rejects malformed or unsupported payloads", (payload) => {
    expect(() => decryptWalletSecret(payload, KEY)).toThrow("Invalid encrypted wallet secret.");
  });

  it("rejects missing environment keys", () => {
    const encrypted = encryptWalletSecret(SECRET, KEY);
    vi.stubEnv("WALLET_ENC_KEY", undefined);

    expect(() => encryptWalletSecret(SECRET)).toThrow("WALLET_ENC_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters.");
    expect(() => decryptWalletSecret(encrypted)).toThrow("WALLET_ENC_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters.");
  });

  it.each(["", "11".repeat(31), "11".repeat(33), "gg".repeat(32), `${KEY}\n`, ` ${KEY}`])(
    "rejects invalid keys for encryption and decryption",
    (key) => {
      const encrypted = encryptWalletSecret(SECRET, KEY);
      const message = "WALLET_ENC_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters.";

      expect(() => encryptWalletSecret(SECRET, key)).toThrow(message);
      expect(() => decryptWalletSecret(encrypted, key)).toThrow(message);
    },
  );

  it("rejects browser use", () => {
    vi.stubGlobal("window", {});

    expect(() => encryptWalletSecret(SECRET, KEY)).toThrow("Wallet encryption is only available on the server.");
    expect(() => decryptWalletSecret("payload", KEY)).toThrow("Wallet encryption is only available on the server.");
  });
});

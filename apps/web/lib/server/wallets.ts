import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("Wallet encryption is only available on the server.");
  }
}

function encryptionKey(keyHex: string | undefined): Buffer {
  const value = keyHex === undefined ? process.env.WALLET_ENC_KEY : keyHex;
  if (typeof value !== "string" || value.length !== 64 || /[^0-9a-f]/i.test(value)) {
    throw new Error("WALLET_ENC_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters.");
  }
  return Buffer.from(value, "hex");
}

/**
 * AES-256-GCM storage: v1:<12-byte IV hex>:<16-byte tag hex>:<ciphertext hex>.
 * WALLET_ENC_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters.
 * The version is authenticated as additional data; all stored hex is lowercase.
 */
export function encryptWalletSecret(secret: string, keyHex?: string): string {
  assertServer();
  if (typeof secret !== "string") throw new Error("Wallet secret must be a string.");
  const key = encryptionKey(keyHex);

  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(VERSION, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
  } catch {
    throw new Error("Unable to encrypt wallet secret.");
  } finally {
    key.fill(0);
  }
}

/** Decrypts a v1 payload only after its GCM authentication tag has been verified. */
export function decryptWalletSecret(payload: string, keyHex?: string): string {
  assertServer();
  const key = encryptionKey(keyHex);

  try {
    if (typeof payload !== "string") throw new Error();
    const parts = payload.split(":");
    const [version, ivHex, tagHex, ciphertextHex] = parts;
    if (
      parts.length !== 4 ||
      version !== VERSION ||
      ivHex.length !== IV_BYTES * 2 ||
      tagHex.length !== TAG_BYTES * 2 ||
      ciphertextHex.length % 2 !== 0 ||
      /[^0-9a-f]/.test(ivHex + tagHex + ciphertextHex)
    ) {
      throw new Error();
    }

    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(VERSION, "utf8"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("Invalid encrypted wallet secret.");
  } finally {
    key.fill(0);
  }
}

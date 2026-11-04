import { PaymentHeaderSchema, type PaymentHeader } from "./schemas";

export const HEADER_PAYMENT = "X-PAYMENT";
export const HEADER_RECEIPT = "X-PAYMENT-RECEIPT";

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodePaymentHeader(header: PaymentHeader): string {
  return toBase64(JSON.stringify(header));
}

export function decodePaymentHeader(raw: string): PaymentHeader {
  try {
    return PaymentHeaderSchema.parse(JSON.parse(fromBase64(raw.trim())));
  } catch {
    throw new Error("Invalid payment header");
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_SIGNATURE = "x-settl-signature";
export const HEADER_DELIVERY = "x-settl-delivery";

const TOLERANCE_SECONDS = 300;

function hmac(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** `t=<unix seconds>,v1=<hex hmac-sha256 of "t.body">` */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

export function verifyWebhook(secret: string, body: string, header: string, now: Date = new Date()): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now.getTime() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(hmac(secret, timestamp, body), "hex");
  const given = Buffer.from(match[2], "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

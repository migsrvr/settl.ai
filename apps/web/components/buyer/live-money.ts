export function phpToExactStroops(value: string, rateCents: string | null): string {
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !rateCents || BigInt(rateCents) <= 0n) throw new Error('Enter a peso amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return ((cents * 10_000_000n + BigInt(rateCents) - 1n) / BigInt(rateCents)).toString();
}
export function money(amount: string | null, rateCents: string | null): string {
  if (amount === null) return 'Unavailable';
  if (!rateCents) return `${BigInt(amount) / 10_000_000n}.${(BigInt(amount) % 10_000_000n).toString().padStart(7, '0')} XLM`;
  const cents = (BigInt(amount) * BigInt(rateCents) + 5_000_000n) / 10_000_000n;
  return `₱${(cents / 100n).toLocaleString('en-PH')}.${(cents % 100n).toString().padStart(2, '0')}`;
}
export function checkoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Checkout did not return a valid link.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Checkout did not return a valid link.');
  return url.href;
}
export const txUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(hash)}`;
export const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n).toString();
export const today = (iso: string) => iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
export const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'UTC' }) + ' UTC';

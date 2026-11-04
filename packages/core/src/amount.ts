const STROOPS_PER_XLM = 10_000_000n;
const DECIMAL = /^\d+(\.\d{1,7})?$/;

/** "2.5" XLM to 25,000,000 stroops. Rejects negatives and more than 7 decimals. */
export function toStroops(xlm: string): bigint {
  if (!DECIMAL.test(xlm)) throw new Error(`Invalid XLM amount: ${xlm}`);
  const [whole, frac = ""] = xlm.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(frac.padEnd(7, "0"));
}

/** 25,000,000 stroops to "2.5000000". */
export function fromStroops(stroops: bigint): string {
  if (stroops < 0n) throw new Error("Negative stroop amount");
  const whole = stroops / STROOPS_PER_XLM;
  const frac = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

function rateInCentavos(phpPerXlm: number): bigint {
  if (!(phpPerXlm > 0)) throw new Error("PHP_PER_XLM must be positive");
  return BigInt(Math.round(phpPerXlm * 100));
}

/** Price a peso amount in stroops, rounding up so the provider is never paid less than quoted. */
export function phpToStroops(php: number, phpPerXlm: number): bigint {
  const centavos = BigInt(Math.round(php * 100));
  const rate = rateInCentavos(phpPerXlm);
  return (centavos * STROOPS_PER_XLM + rate - 1n) / rate;
}

/** Show a stroop amount in pesos, rounded to the centavo. */
export function stroopsToPhp(stroops: bigint, phpPerXlm: number): number {
  const rate = rateInCentavos(phpPerXlm);
  const centavos = (stroops * rate + STROOPS_PER_XLM / 2n) / STROOPS_PER_XLM;
  return Number(centavos) / 100;
}

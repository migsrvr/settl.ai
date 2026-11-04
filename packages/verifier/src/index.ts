import * as z from "zod";

export type CheckResult = { check: string; ok: boolean; note: string };
export type Verification = { result: "pass" | "fail" | "error"; checks: CheckResult[] };
export type Criteria = {
  schema: string;
  required?: string[];
  minConfidence?: number;
  lineItemsSumToTotal?: { tolerance: number };
};

const ReceiptV1 = z.object({
  merchant_name: z.string().optional(),
  date: z.string().optional(),
  total: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  line_items: z.array(z.object({ description: z.string(), amount: z.number() })).optional(),
});

const DEFAULT_REQUIRED = ["merchant_name", "date", "total", "line_items"] as const;

function peso(n: number) {
  return `₱${n.toFixed(2)}`;
}

function receiptV1(criteria: Criteria, output: unknown, now: Date): Verification {
  const parsed = ReceiptV1.safeParse(output);
  if (!parsed.success || typeof output !== "object" || output === null || Array.isArray(output)) {
    return { result: "fail", checks: [{ check: "schema", ok: false, note: "Not a receipt v1 object" }] };
  }
  const r = parsed.data;
  const checks: CheckResult[] = [{ check: "schema", ok: true, note: "v1" }];

  const required = criteria.required ?? [...DEFAULT_REQUIRED];
  const missing = required.filter((k) => {
    const v = (r as Record<string, unknown>)[k];
    return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  });
  checks.push({
    check: "required",
    ok: missing.length === 0,
    note: missing.length === 0 ? `${required.length} of ${required.length}` : `Missing ${missing.join(", ")}`,
  });

  const min = criteria.minConfidence ?? 0;
  const confidence = r.confidence ?? 0;
  checks.push({
    check: "confidence",
    ok: confidence >= min,
    note: confidence >= min ? confidence.toFixed(2) : `${confidence.toFixed(2)}, needs ${min.toFixed(2)}`,
  });

  if (criteria.lineItemsSumToTotal) {
    const sum = (r.line_items ?? []).reduce((s, li) => s + li.amount, 0);
    const total = r.total ?? Number.NaN;
    const ok = Math.abs(sum - total) <= criteria.lineItemsSumToTotal.tolerance;
    checks.push({ check: "lineItemsSumToTotal", ok, note: ok ? peso(total) : `${peso(sum)} vs ${peso(total)}` });
  }

  const when = r.date ? new Date(r.date) : null;
  const dateOk = !!when && !Number.isNaN(when.getTime()) && when.getTime() <= now.getTime();
  checks.push({ check: "dateSanity", ok: dateOk, note: r.date ?? "No date" });

  return { result: checks.every((c) => c.ok) ? "pass" : "fail", checks };
}

const SCHEMAS: Record<string, (c: Criteria, o: unknown, now: Date) => Verification> = {
  "resibo.receipt.v1": receiptV1,
};

/** Runs deterministic checks for an outcome-mode result. Never throws on bad output. */
export function runChecks(criteria: Criteria, output: unknown, now: Date = new Date()): Verification {
  const run = SCHEMAS[criteria.schema];
  if (!run) return { result: "error", checks: [{ check: "criteria", ok: false, note: `Unknown schema ${criteria.schema}` }] };
  try {
    return run(criteria, output, now);
  } catch {
    return { result: "error", checks: [{ check: "verifier", ok: false, note: "Verifier failed, nothing charged" }] };
  }
}

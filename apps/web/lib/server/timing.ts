import { randomUUID } from "node:crypto";

export type TimingPhase =
  | "auth"
  | "db"
  | "rpc_prep"
  | "settlement"
  | "provider_call"
  | "post_payment";

export interface TimingSummary {
  correlationId: string;
  operation: string;
  status: string;
  totalMs: number;
  phases: Partial<Record<TimingPhase, number>>;
  meta?: Record<string, string | number | boolean>;
}

const SAFE_CORRELATION = /^[A-Za-z0-9_-]{4,64}$/;
const SENSITIVE_KEY = /secret|token|key|auth|sig|password|cookie|body|payload|xdr|seed|private/i;
const SENSITIVE_VALUE = /stl_agent_|Bearer\s+|v1:[0-9a-f]+:|^S[A-Z2-7]{55}$/i;

export function sanitizeCorrelationId(candidate?: string | null): string {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (SAFE_CORRELATION.test(trimmed) && !SENSITIVE_VALUE.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    } else if (typeof v === "string" && v.length <= 128 && !SENSITIVE_VALUE.test(v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface TimingOptions {
  correlationId?: string | null;
  nowMs?: () => number;
  sink?: (summary: TimingSummary) => void;
}

export function createTimingTracker(operation: string, options: TimingOptions = {}) {
  const nowMs = options.nowMs ?? (() => Math.round(performance.now()));
  const correlationId = sanitizeCorrelationId(options.correlationId);
  const startMs = nowMs();
  const phases: Partial<Record<TimingPhase, number>> = {};

  async function measure<T>(phase: TimingPhase, fn: () => Promise<T> | T): Promise<T> {
    const phaseStart = nowMs();
    try {
      return await fn();
    } finally {
      const elapsed = Math.max(0, Math.round(nowMs() - phaseStart));
      phases[phase] = (phases[phase] ?? 0) + elapsed;
    }
  }

  function finish(status: string, meta?: Record<string, unknown>): TimingSummary {
    const totalMs = Math.max(0, Math.round(nowMs() - startMs));
    const safeMeta = sanitizeMeta(meta);
    const summary: TimingSummary = {
      correlationId,
      operation,
      status,
      totalMs,
      phases: { ...phases },
      ...(safeMeta ? { meta: safeMeta } : {}),
    };
    if (options.sink) {
      options.sink(summary);
    } else if (process.env.NODE_ENV !== "test") {
      console.info("settl_timing", summary);
    }
    return summary;
  }

  return {
    correlationId,
    measure,
    finish,
  };
}


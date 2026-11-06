"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Pill, Spinner, type Tone } from "@/components/ui";

type ApprovalStatus = "pending" | "approved" | "declined" | "expired";
type PaymentStatus = "pending" | "paid" | "not_charged" | "blocked" | "failed";
type Snapshot = {
  id: string;
  status: ApprovalStatus;
  amountPhp: string;
  providerName: string;
  agentName: string;
  expiresAt: string;
  quoteId: string;
  payment: { status: PaymentStatus; txHash?: string } | null;
  capPhp?: string;
  autoApprovePhp?: string;
};
type Phase = "ask" | "submitting" | "approved" | "paid" | "declined" | "expired";
const CHIPS: Record<Phase, { label: string; tone: Tone }> = {
  ask: { label: "Needs you", tone: "info" },
  submitting: { label: "Submitting", tone: "info" },
  approved: { label: "Approved", tone: "accent" },
  paid: { label: "Paid", tone: "paid" },
  declined: { label: "Declined", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function snapshotFrom(value: unknown, id: string): Snapshot {
  if (!isObject(value) || value.id !== id || !["pending", "approved", "declined", "expired"].includes(String(value.status))
    || typeof value.amountPhp !== "string" || !/^\d+\.\d{2}$/.test(value.amountPhp)
    || typeof value.providerName !== "string" || typeof value.agentName !== "string" || typeof value.quoteId !== "string"
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || value.payment !== null && (!isObject(value.payment) || !["pending", "paid", "not_charged", "blocked", "failed"].includes(String(value.payment.status))
      || value.payment.txHash !== undefined && (typeof value.payment.txHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.payment.txHash)))
    || value.capPhp !== undefined && (typeof value.capPhp !== "string" || !/^\d+\.\d{2}$/.test(value.capPhp))
    || value.autoApprovePhp !== undefined && (typeof value.autoApprovePhp !== "string" || !/^\d+\.\d{2}$/.test(value.autoApprovePhp))) throw new Error("invalid_snapshot");
  return value as Snapshot;
}

// A changed route ID starts a fresh component, aborting the prior request.
export function ApprovalCard({ approvalId }: { approvalId?: string }) {
  return <LiveApprovalCard key={approvalId ?? "missing"} approvalId={approvalId} />;
}

function LiveApprovalCard({ approvalId }: { approvalId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(approvalId ? null : "This approval is unavailable. Open the link from your agent.");
  const [submitting, setSubmitting] = useState<"approved" | "declined" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const version = useRef(0);
  const submission = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    if (!approvalId) return;
    let stopped = false;
    let fetching = false;
    let active: AbortController | null = null;
    async function load() {
      if (fetching || submission.current) return;
      fetching = true;
      const revision = version.current;
      const controller = new AbortController();
      active = controller;
      const deadline = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId!)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = snapshotFrom(await response.json(), approvalId!);
        if (stopped || revision !== version.current) return;
        setSnapshot(next); setError(null);
        if (next.status === "declined" || next.status === "expired" || next.payment && next.payment.status !== "pending") clearInterval(interval);
      } catch {
        if (!stopped && revision === version.current) setError("The approval could not be loaded. Refresh it to check the latest status.");
      } finally { clearTimeout(deadline); fetching = false; }
    }
    void load();
    const interval = setInterval(() => { void load(); }, 3_000);
    return () => { stopped = true; clearInterval(interval); active?.abort(); };
  }, [approvalId, refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; submission.current?.abort(); };
  }, []);

  async function resolve(decision: "approved" | "declined") {
    if (!approvalId || !snapshot || submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    version.current++;
    setSubmitting(decision); setError(null);
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }), signal: controller.signal,
      });
      if (response.status === 409) {
        if (!mounted.current) return;
        setError("This approval changed. Refresh it to check the latest status.");
        setRefresh((value) => value + 1);
        return;
      }
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (!isObject(result) || result.id !== approvalId || result.status !== decision) throw new Error();
      if (mounted.current && !controller.signal.aborted) setSnapshot((current) => current ? { ...current, status: decision } : current);
    } catch {
      if (mounted.current) setError("The decision could not be confirmed. Refresh the approval before trying again.");
    } finally {
      clearTimeout(deadline);
      if (submission.current === controller) { submission.current = null; if (mounted.current) setSubmitting(null); }
    }
  }

  const phase: Phase = submitting ? "submitting"
    : snapshot?.payment?.status === "paid" ? "paid"
      : snapshot?.status === "approved" ? "approved"
        : snapshot?.status === "declined" ? "declined"
          : snapshot?.status === "expired" ? "expired" : "ask";
  const chip = CHIPS[phase];
  return (
    <div className="flex flex-1 flex-col gap-6">
      <section aria-labelledby="ask-title" className="flex flex-col gap-4">
        {snapshot && <Pill tone={chip.tone} className="self-start">{chip.label}</Pill>}
        <h1 id="ask-title" className="font-display text-2xl font-bold tracking-[-0.025em]">
          {snapshot ? `Pay ${snapshot.providerName} ₱${snapshot.amountPhp}?` : "Approval"}
        </h1>
        {snapshot && <>
          <p className="text-ink-2">{snapshot.agentName} wants to pay {snapshot.providerName} ₱{snapshot.amountPhp} for this request.</p>
          <dl className="flex flex-col border-b border-rule">
            {snapshot.autoApprovePhp !== undefined && <Fact label="Pays without asking" value={`Up to ₱${snapshot.autoApprovePhp}`} />}
            {snapshot.capPhp !== undefined && <Fact label="Cap on Stellar" value={`₱${snapshot.capPhp}`} />}
            <Fact label="Approval expires" value={new Date(snapshot.expiresAt).toLocaleString()} />
          </dl>
        </>}
      </section>
      <div className="mt-auto flex flex-col gap-3" aria-live="polite" aria-atomic="true">
        {!snapshot && !error && <p role="status" className="flex items-center gap-3"><Spinner /> Loading approval…</p>}
        {error && <>
          <p role="alert" className="text-blocked">{error}</p>
          {approvalId && <Button size="lg" disabled={!!submitting} onClick={() => setRefresh((value) => value + 1)}>Refresh approval</Button>}
        </>}
        {snapshot && !error && (phase === "ask" || phase === "submitting") && <>
          <Button variant="primary" size="lg" disabled={!!submitting} onClick={() => { void resolve("approved"); }}>
            {submitting === "approved" ? "Approving…" : `Approve ₱${snapshot.amountPhp} once`}
          </Button>
          <Button size="lg" disabled={!!submitting} onClick={() => { void resolve("declined"); }}>{submitting === "declined" ? "Declining…" : "Decline"}</Button>
          <p className="text-center text-xs text-muted">Approval lets the agent continue. Payment is confirmed separately.</p>
        </>}
        {snapshot && phase === "approved" && <div role="status" className="flex flex-col gap-1 py-4">
          <span className="font-medium">Approved. Waiting for the agent to continue.</span>
          <span className="text-sm text-ink-2">{snapshot.payment?.status === "not_charged" ? "The call was not charged." : snapshot.payment?.status === "failed" || snapshot.payment?.status === "blocked" ? "Payment did not complete. Check the agent’s activity before trying again." : "This page updates when the payment is confirmed."}</span>
        </div>}
        {snapshot && phase === "paid" && <div role="status" className="flex flex-col gap-1 py-4">
          <span className="text-lg font-medium text-paid">{snapshot.providerName} got ₱{snapshot.amountPhp}</span>
          {snapshot.payment?.txHash && <a className="font-mono text-sm" href={`https://stellar.expert/explorer/testnet/tx/${snapshot.payment.txHash}`} target="_blank" rel="noreferrer">Transaction {snapshot.payment.txHash.slice(0, 8)}…{snapshot.payment.txHash.slice(-4)}</a>}
        </div>}
        {phase === "declined" && <p role="status" className="py-4 font-medium">Declined. This approval cannot be used.</p>}
        {phase === "expired" && <p role="status" className="py-4 font-medium">This approval expired. Ask the agent for a new request.</p>}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-t border-rule py-3"><dt className="text-ink-2">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

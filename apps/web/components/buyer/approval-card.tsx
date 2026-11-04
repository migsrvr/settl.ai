"use client";

import { useEffect, useState } from "react";
import { Button, Pill, Spinner, type Tone } from "@/components/ui";
import { STELLAR_EXPERT } from "@/lib/demo-data";

type Phase = "ask" | "settling" | "paid" | "declined";

const CHIP: Record<Phase, { label: string; tone: Tone }> = {
  ask: { label: "Needs you", tone: "info" },
  settling: { label: "Approved", tone: "accent" },
  paid: { label: "Paid", tone: "paid" },
  declined: { label: "Declined", tone: "neutral" },
};

const FACTS = [
  ["Pays without asking", "Up to ₱5.00"],
  ["Cap on Stellar", "₱10.00, so this fits"],
  ["Budget afterwards", "₱30.00 of ₱50.00"],
  ["Charged", "Before the call runs"],
];

export function ApprovalCard() {
  const [phase, setPhase] = useState<Phase>("ask");

  useEffect(() => {
    if (phase !== "settling") return;
    const t = setTimeout(() => setPhase("paid"), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <section aria-labelledby="ask-title" className="flex flex-col gap-4">
        <Pill tone={CHIP[phase].tone} className="self-start">
          {CHIP[phase].label}
        </Pill>
        <h1 id="ask-title" className="font-display text-2xl font-bold tracking-[-0.025em]">
          Pay GeoPH ₱8.00?
        </h1>
        <p className="text-ink-2">Juan’s Bookkeeper wants to geocode 40 client addresses for the delivery report. GeoPH quoted ₱8.00 for the batch.</p>
        <dl className="flex flex-col border-b border-rule">
          {FACTS.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-t border-rule py-3">
              <dt className="text-ink-2">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-auto flex flex-col gap-3" aria-live="polite">
        {phase === "ask" && (
          <>
            <Button variant="primary" size="lg" onClick={() => setPhase("settling")}>
              Approve ₱8.00 once
            </Button>
            <Button size="lg" onClick={() => setPhase("declined")}>
              Decline
            </Button>
            <span className="text-center text-xs text-muted">If you don’t answer in 5 minutes, nothing is paid.</span>
          </>
        )}
        {phase === "settling" && (
          <div role="status" className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3 py-4">
            <span className="mt-1">
              <Spinner />
            </span>
            <span className="flex flex-col">
              <span className="font-medium">Settling on Stellar…</span>
              <span className="text-sm text-ink-2">The agent carries on once it lands.</span>
            </span>
          </div>
        )}
        {phase === "paid" && (
          <div role="status" className="flex animate-rise flex-col gap-1 py-4">
            <span className="text-lg font-medium text-paid">GeoPH got ₱8.00</span>
            <span className="text-sm text-ink-2">
              Transaction <a href={STELLAR_EXPERT} className="font-mono">b8e1…40fa</a>
            </span>
          </div>
        )}
        {phase === "declined" && (
          <div role="status" className="flex animate-rise flex-col gap-1 py-4">
            <span className="text-lg font-medium">Declined. Nothing was paid.</span>
            <span className="text-sm text-ink-2">The agent was told you said no and skipped this step.</span>
          </div>
        )}
        {(phase === "paid" || phase === "declined") && (
          <button type="button" onClick={() => setPhase("ask")} className="min-h-11 font-medium underline">
            Reset the demo
          </button>
        )}
      </div>
    </div>
  );
}

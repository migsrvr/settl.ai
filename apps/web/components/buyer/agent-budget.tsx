"use client";

import { useEffect, useState } from "react";
import { Button, Meter, Spinner } from "@/components/ui";
import { STELLAR_EXPERT } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

type Phase = "idle" | "choose" | "checkout" | "confirming" | "done";

const AMOUNTS = [50, 100, 200];

export function AgentBudget({ left, loaded }: { left: number; loaded: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [amount, setAmount] = useState(50);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    if (phase === "checkout") {
      const t = setTimeout(() => setPhase("confirming"), 1500);
      return () => clearTimeout(t);
    }
    if (phase === "confirming") {
      const t = setTimeout(() => {
        setAdded((a) => a + amount);
        setPhase("done");
      }, 1700);
      return () => clearTimeout(t);
    }
  }, [phase, amount]);

  return (
    <section aria-labelledby="bal-title" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4 rounded-xl border border-rule bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="bal-title" className="text-xs font-normal text-muted">Budget left in escrow</h2>
          <span className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-4xl font-bold tracking-[-0.03em]">{formatPeso(left + added)}</span>
            <span className="text-ink-2">of {formatPeso(loaded + added)} loaded</span>
          </span>
        </div>
        {(phase === "idle" || phase === "done") && (
          <Button variant="primary" onClick={() => setPhase("choose")}>
            Load budget
          </Button>
        )}
      </div>
      <Meter value={left + added} max={loaded + added} />
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <div>
          <dt className="text-xs text-muted">Spent</dt>
          <dd className="font-medium">₱12.00</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Kept on failed results</dt>
          <dd className="font-medium">₱2.00</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Used of today’s ₱20.00</dt>
          <dd className="font-medium">₱12.00</dd>
        </div>
      </dl>

      <div aria-live="polite">
        {phase === "choose" && (
          <div className="flex animate-rise flex-col gap-3 border-t border-rule pt-4">
            <h3 id="amt-title" className="text-base font-medium">How much to load?</h3>
            <div role="radiogroup" aria-labelledby="amt-title" className="flex flex-wrap gap-2">
              {AMOUNTS.map((v) => {
                const on = v === amount;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setAmount(v)}
                    className={`press min-h-10 rounded-md border px-4 font-medium ${on ? "border-ink bg-saffron-well" : "border-edge hover:bg-well"}`}
                  >
                    {formatPeso(v)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setPhase("idle")}>Cancel</Button>
              <Button variant="primary" onClick={() => setPhase("checkout")}>
                Continue to Velo Checkout
              </Button>
            </div>
          </div>
        )}
        {(phase === "checkout" || phase === "confirming") && (
          <div role="status" className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3 border-t border-rule pt-4">
            <span className="mt-1">
              <Spinner />
            </span>
            <span className="flex flex-col">
              <span className="font-medium">{phase === "checkout" ? "Paying on Velo Checkout…" : "Waiting for Velo to confirm…"}</span>
              <span className="text-sm text-ink-2">
                {phase === "checkout"
                  ? "It opens in a new tab. Come back here when you’re done."
                  : "Once Velo confirms, Settl moves the money into escrow on Stellar."}
              </span>
            </span>
          </div>
        )}
        {phase === "done" && (
          <div role="status" className="flex animate-rise flex-wrap items-baseline justify-between gap-3 border-t border-rule pt-4">
            <span className="font-medium text-paid">{formatPeso(amount)} is now in this agent’s escrow</span>
            <span className="flex items-baseline gap-4">
              <a href={STELLAR_EXPERT} className="font-mono text-sm">5d10…e7a2</a>
              <button
                type="button"
                onClick={() => {
                  setAdded(0);
                  setAmount(50);
                  setPhase("idle");
                }}
                className="min-h-10 font-medium underline"
              >
                Reset the demo
              </button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

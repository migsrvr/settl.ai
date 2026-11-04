"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui";
import { claimReducer, initialClaim } from "@/lib/claim";
import { CLAIM_HISTORY, STELLAR_EXPERT } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

const COLS = "grid grid-cols-[112px_112px_minmax(0,1fr)_144px_120px] gap-4";

export function ClaimPanel() {
  const [state, dispatch] = useReducer(claimReducer, initialClaim);

  useEffect(() => {
    if (state.phase !== "settling") return;
    const t = setTimeout(() => dispatch({ type: "settled" }), 2400);
    return () => clearTimeout(t);
  }, [state.phase]);

  const amount = formatPeso(initialClaim.pending);
  const history = state.phase === "done" ? [{ when: "Today, 10:45 AM", amount: initialClaim.pending, tx: "7c2d…a90b" }, ...CLAIM_HISTORY] : CLAIM_HISTORY;

  return (
    <>
      <section aria-labelledby="bal-title" className="flex flex-wrap rounded-xl border border-rule bg-surface">
        <div className="flex min-w-0 flex-[999_1_360px] flex-col gap-4 border-r border-rule p-6">
          <div className="flex flex-col gap-1">
            <h2 id="bal-title" className="text-xs font-normal text-muted">Waiting in escrow</h2>
            <span className="font-display text-4xl font-bold tracking-[-0.03em]">{formatPeso(state.pending)}</span>
          </div>
          <dl className="flex flex-col">
            {[
              ["Paid calls since your last claim", String(state.sinceCalls)],
              ["Claimed so far", formatPeso(state.claimed)],
              ["Earned in total", formatPeso(136)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-rule py-3">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col justify-center gap-3 p-6" aria-live="polite">
          {state.phase === "idle" && (
            <div className="flex animate-rise flex-col gap-3">
              <span className="text-xs text-muted">Pays out to</span>
              <span className="font-mono text-sm">GB7Q…X4F, ResiboAI wallet</span>
              <Button variant="primary" size="lg" onClick={() => dispatch({ type: "open" })}>
                Claim {amount}
              </Button>
              <span className="text-xs text-muted">One transaction. Velo pays the network fee.</span>
            </div>
          )}
          {state.phase === "confirm" && (
            <div role="dialog" aria-labelledby="confirm-title" className="flex animate-rise flex-col gap-3">
              <h3 id="confirm-title" className="text-lg font-medium">Claim {amount} to GB7Q…X4F?</h3>
              <p className="text-ink-2">This moves every pending payment out of escrow. It can’t be reversed.</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => dispatch({ type: "cancel" })}>Keep in escrow</Button>
                <Button variant="primary" onClick={() => dispatch({ type: "confirm" })}>
                  Claim {amount}
                </Button>
              </div>
            </div>
          )}
          {state.phase === "settling" && (
            <div role="status" className="flex flex-col gap-3">
              <span className="font-medium">Settling on Stellar…</span>
              <span className="block h-1 overflow-hidden rounded-sm bg-saffron-well">
                <span className="block h-full w-full origin-left animate-progress bg-saffron" />
              </span>
              <span className="text-xs text-muted">Usually about 5 seconds. You can leave this page.</span>
            </div>
          )}
          {state.phase === "done" && (
            <div role="status" className="flex animate-rise flex-col gap-2">
              <span className="text-lg font-medium text-paid">{amount} is in your wallet</span>
              <span className="text-sm text-ink-2">
                Transaction <a href={STELLAR_EXPERT} className="font-mono">7c2d…a90b</a>
              </span>
              <button type="button" onClick={() => dispatch({ type: "reset" })} className="min-h-10 self-start font-medium underline">
                Reset the demo
              </button>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="claims-title" className="flex flex-col gap-2">
        <h2 id="claims-title" className="text-lg font-medium">Claims</h2>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className={`${COLS} border-b border-rule py-2 text-xs text-muted`}>
              <span>Amount</span>
              <span>Status</span>
              <span>Paid to</span>
              <span>Date</span>
              <span>Transaction</span>
            </div>
            {history.map((h) => (
              <div key={h.tx} className={`${COLS} min-h-14 items-center border-b border-rule`}>
                <span className="font-medium">{formatPeso(h.amount)}</span>
                <span>
                  <span className="rounded-sm bg-paid-bg px-2 py-0.5 text-xs font-medium text-paid">Completed</span>
                </span>
                <span className="font-mono text-sm text-ink-2">GB7Q…X4F</span>
                <span className="text-ink-2">{h.when}</span>
                <a href={STELLAR_EXPERT} className="font-mono text-sm">
                  {h.tx}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

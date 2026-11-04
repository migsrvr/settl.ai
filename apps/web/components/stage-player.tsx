"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Logo, Spinner } from "@/components/ui";
import { formatPeso } from "@/lib/format";
import { initialStage, laneFor, runStage, stopAt, STAGE_SCENARIOS, type GateStatus, type StageState } from "@/lib/stage";
import { STELLAR_EXPERT } from "@/lib/demo-data";

const STEP_MS = 750;

const CARD: Record<GateStatus, string> = {
  done: "border border-rule bg-surface",
  fail: "border border-blocked-edge bg-blocked-bg",
  blocked: "border border-blocked-edge bg-blocked-bg",
  active: "border border-ink bg-surface",
  skip: "border border-dashed border-edge opacity-70",
  idle: "border border-rule",
};

function GateIcon({ status, n }: { status: GateStatus; n: number }) {
  const circle = "inline-flex size-8 shrink-0 items-center justify-center rounded-full";
  if (status === "done")
    return (
      <span className={`${circle} bg-ink text-on-ink`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  if (status === "fail" || status === "blocked")
    return (
      <span className={`${circle} bg-blocked text-on-ink`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          {status === "fail" ? <path d="M18 6 6 18M6 6l12 12" /> : <><circle cx="12" cy="12" r="8" /><path d="m6.4 6.4 11.2 11.2" /></>}
        </svg>
      </span>
    );
  if (status === "active") return <Spinner size={32} label="Working" />;
  return <span className={`${circle} border border-edge font-mono text-sm text-ink-2`}>{n}</span>;
}

export function StagePlayer() {
  const [state, setState] = useState<StageState>(initialStage);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function clear() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function run(i: number) {
    if (state.running) return;
    clear();
    const last = stopAt(i);
    setState((s) => ({ ...s, scenario: i, step: 0, running: true, delta: false }));
    for (let step = 1; step <= last; step++) {
      timers.current.push(setTimeout(() => setState((s) => ({ ...s, step })), step * STEP_MS));
    }
    timers.current.push(setTimeout(() => setState((s) => runStage(s, i)), last * STEP_MS + 500));
  }

  function reset() {
    clear();
    setState(initialStage);
  }

  const scenario = state.scenario >= 0 ? STAGE_SCENARIOS[state.scenario] : null;
  const thought = !scenario ? "Three receipts to file. I pay for a tool only when it’s worth it." : state.running ? scenario.before : scenario.after;
  const nextUp = STAGE_SCENARIOS.findIndex((_, i) => !state.ran.includes(i));

  return (
    <div className="mx-auto box-border flex min-h-dvh w-full max-w-[1280px] flex-col gap-6 px-10 py-6">
      <div className="flex flex-wrap items-center gap-6">
        <Link href="/" className="text-lg text-ink no-underline">
          <Logo />
        </Link>
        <span className="rounded-sm bg-info-bg px-2 py-0.5 text-sm font-medium text-info">Live on Stellar testnet</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {STAGE_SCENARIOS.map((s, i) => (
            <Button key={s.label} variant={i === nextUp ? "primary" : "quiet"} disabled={state.running} onClick={() => run(i)}>
              {s.label}
            </Button>
          ))}
          <Button onClick={reset}>Reset</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <section aria-labelledby="think-title" className="flex min-w-0 flex-[1.4_1_520px] flex-col gap-4 rounded-xl border border-rule bg-surface px-10 py-6">
          <div className="flex items-baseline gap-4">
            <h2 id="think-title" className="text-lg font-medium">Juan’s Bookkeeper is deciding</h2>
            <span className="ml-auto text-ink-2">{scenario?.receipt ?? "Ready"}</span>
          </div>
          <p key={thought} aria-live="polite" className="max-w-[40ch] animate-rise font-display text-2xl font-bold tracking-[-0.015em]">
            “{thought}”
          </p>
        </section>

        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
          <section aria-labelledby="earn-title" className="flex flex-1 flex-col gap-1 border-t border-rule pt-4">
            <h2 id="earn-title" className="font-normal text-ink-2">ResiboAI has earned</h2>
            <div className="flex items-baseline gap-4">
              <span className="font-display text-5xl font-bold tracking-[-0.035em]">{formatPeso(state.earned)}</span>
              {state.delta ? <span className="animate-rise rounded-sm bg-saffron px-2 py-0.5 text-lg font-medium text-ink">+₱2.00</span> : null}
            </div>
          </section>
          <section aria-labelledby="budget-title" className="flex flex-1 flex-col gap-2 border-t border-rule pt-4">
            <div className="flex items-baseline justify-between">
              <h2 id="budget-title" className="font-normal text-ink-2">Agent budget left</h2>
              <span className="text-ink-2">Cap ₱10 per payment</span>
            </div>
            <span className="flex items-baseline gap-3">
              <span className="font-display text-3xl font-bold tracking-[-0.03em]">{formatPeso(state.budget)}</span>
              <span className="text-lg text-ink-2">of ₱50.00</span>
            </span>
            <div className="h-1.5 overflow-hidden rounded-sm bg-saffron-well">
              <div className="h-full bg-ink" style={{ width: `${Math.round((state.budget / 50) * 100)}%` }} />
            </div>
          </section>
        </div>
      </div>

      <ol aria-label="Steps of this payment" className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {laneFor(state).map((g, i) => (
          <li key={i} className={`flex flex-col gap-3 rounded-xl p-4 ${CARD[g.status]}`}>
            <div className="flex items-center gap-3">
              <GateIcon status={g.status} n={i + 1} />
              <span className="text-lg font-medium">{g.label}</span>
            </div>
            <span className="text-ink-2">{g.detail}</span>
          </li>
        ))}
      </ol>

      <div className="flex min-h-14 flex-wrap items-center gap-4 rounded-lg bg-ink px-6 py-2 text-code">
        <span className="whitespace-nowrap text-sm text-code-dim">Settled on Stellar</span>
        {state.txs.length === 0 ? (
          <span className="text-sm text-code-dim">Transactions show here as they land.</span>
        ) : (
          state.txs.map((t) => (
            <a key={t} href={STELLAR_EXPERT} className="animate-rise whitespace-nowrap rounded-sm bg-code-chip px-3 py-1 font-mono text-sm text-code no-underline">
              {t}
            </a>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button, Pill, TabBar } from "@/components/ui";
import { formatPeso } from "@/lib/format";
import { CALLS, CALL_TABS, checksFor, eventsFor, filterCalls, type CallFilter } from "@/lib/demo-data";

const ROW = "grid grid-cols-[104px_128px_minmax(0,1.3fr)_minmax(0,1fr)_64px] gap-4";

const DOT: Record<"info" | "good" | "bad", string> = {
  info: "bg-ink",
  good: "bg-paid",
  bad: "bg-blocked",
};

export function CallsPanel() {
  const [filter, setFilter] = useState<CallFilter>("all");
  const [selectedId, setSelectedId] = useState("call_0b77d4a2");
  const rows = filterCalls(filter);
  const call = CALLS.find((c) => c.id === selectedId) ?? CALLS[0];
  const paid = call.status === "paid";

  return (
    <div className="flex flex-wrap items-start gap-10">
      <section aria-labelledby="calls-title" className="flex min-w-0 flex-[999_1_520px] flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="calls-title" className="text-lg font-medium">Recent calls</h2>
          <Button size="sm">Export CSV</Button>
        </div>
        <TabBar label="Filter calls" tabs={CALL_TABS} value={filter} onChange={setFilter} />
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className={`${ROW} border-b border-rule py-2 text-xs text-muted`}>
              <span>Amount</span>
              <span>Status</span>
              <span>Agent</span>
              <span>Endpoint</span>
              <span className="text-right">Time</span>
            </div>
            {rows.length === 0 ? (
              <p className="border-b border-rule py-6 text-ink-2">No blocked calls today. Agents that hit their on-chain cap show up here.</p>
            ) : (
              rows.map((c) => {
                const on = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedId(c.id)}
                    className={`${ROW} min-h-14 w-full items-center border-b border-rule py-2 text-left ${on ? "bg-saffron-well" : "hover:bg-well"}`}
                  >
                    <span className="font-medium">{formatPeso(c.amount)}</span>
                    <span>{c.status === "paid" ? <Pill tone="paid">Paid</Pill> : <Pill tone="neutral">Not charged</Pill>}</span>
                    <span className="flex min-w-0 flex-col leading-snug">
                      <span className="truncate">{c.agent}</span>
                      <span className="text-xs text-muted">{c.org}</span>
                    </span>
                    <span className="truncate font-mono text-xs text-ink-2">{c.endpoint}</span>
                    <span className="text-right text-muted">{c.time}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>

      <aside aria-labelledby="detail-title" className="min-w-0 flex-[1_1_320px] rounded-xl border border-rule bg-surface">
        <div key={call.id} className="animate-rise">
          <div className="flex flex-col gap-1 border-b border-rule p-6">
            <h2 id="detail-title" className="text-xs font-normal text-muted">Selected call</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-medium tracking-[-0.01em]">{formatPeso(call.amount)}</span>
              {paid ? <Pill tone="paid">Paid</Pill> : <Pill tone="neutral">Not charged</Pill>}
            </div>
            <span className="font-mono text-xs text-muted">{call.id}</span>
          </div>

          <div className="flex flex-col gap-4 border-b border-rule p-6">
            <h3 className="text-sm font-medium">What happened</h3>
            <ol className="flex flex-col gap-3">
              {eventsFor(call).map((e) => (
                <li key={e.text} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-3">
                  <span className={`size-2 rounded-full ${DOT[e.tone]}`} aria-hidden="true" />
                  <span>{e.text}</span>
                  <span className="font-mono text-xs text-muted">{e.time}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-2 border-b border-rule p-6">
            <h3 className="mb-1 text-sm font-medium">Checks</h3>
            {checksFor(call).map((c) => (
              <div key={c.label} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2">
                {c.ok ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-paid)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Passed">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-blocked)" strokeWidth="2.5" strokeLinecap="round" role="img" aria-label="Failed">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                )}
                <span>{c.label}</span>
                <span className="font-mono text-xs text-muted">{c.note}</span>
              </div>
            ))}
          </div>

          <dl className="grid grid-cols-2 gap-4 p-6">
            <div>
              <dt className="text-xs text-muted">Customer</dt>
              <dd>{call.org}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Agent</dt>
              <dd>{call.agent}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Pricing</dt>
              <dd>Settl on Result</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Nonce</dt>
              <dd className="font-mono text-sm">{call.nonce}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Transaction</dt>
              <dd className="font-mono text-sm">{call.tx}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}

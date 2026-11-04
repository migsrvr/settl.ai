"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, ButtonLink, Spinner } from "@/components/ui";

const STEPS = [
  { title: "Register its identity", detail: "device_registry links it to your org wallet" },
  { title: "Write its limits", detail: "agent_registry stores the cap and end date" },
];

const FIELD = "min-h-10 rounded-md border border-edge bg-surface px-3";

export function NewAgentForm() {
  const [name, setName] = useState("Juan’s Bookkeeper");
  const [cap, setCap] = useState("10.00");
  const [expiry, setExpiry] = useState("2026-12-31");
  const [providers, setProviders] = useState({ resibo: true, geoph: true });
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage !== 1 && stage !== 2) return;
    const t = setTimeout(() => setStage((s) => s + 1), stage === 1 ? 1300 : 1400);
    return () => clearTimeout(t);
  }, [stage]);

  const busy = stage === 1 || stage === 2;
  const providerCount = Number(providers.resibo) + Number(providers.geoph);

  function create() {
    if (!name.trim()) {
      setError("Give the agent a name so providers know who’s paying.");
      document.getElementById("agent-name")?.focus();
      return;
    }
    setError(null);
    setStage(1);
  }

  return (
    <div className="flex flex-wrap items-start gap-10">
      <form className="flex min-w-0 flex-[999_1_520px] flex-col" onSubmit={(e) => e.preventDefault()}>
        <Row title="Name" body="Providers see it on every payment.">
          <div className="flex flex-col gap-1">
            <label htmlFor="agent-name" className="text-sm font-medium">Agent name</label>
            <input
              id="agent-name"
              name="agentName"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby="name-help"
              className={FIELD}
            />
            <span id="name-help" className="min-h-[1lh] text-xs text-blocked">{error}</span>
          </div>
        </Row>

        <Row title="Limits on Stellar" body="Stored in agent_registry. The network refuses any payment outside them, whatever the agent’s code does.">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="cap" className="text-sm font-medium">Most per payment, ₱</label>
              <input id="cap" name="cap" inputMode="decimal" autoComplete="off" value={cap} onChange={(e) => setCap(e.target.value)} className={FIELD} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="expiry" className="text-sm font-medium">Stops working on</label>
              <input id="expiry" name="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={FIELD} />
            </div>
          </div>
        </Row>

        <Row title="Spending rules" body="Settl checks these before every payment. Change them any time." last>
          <fieldset className="flex flex-col">
            <legend className="mb-1 text-sm font-medium">Providers it may pay</legend>
            {(
              [
                ["resibo", "ResiboAI, receipt reading"],
                ["geoph", "GeoPH, address lookup"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-10 items-center gap-3">
                <input
                  type="checkbox"
                  name="providers"
                  value={key}
                  checked={providers[key]}
                  onChange={(e) => setProviders((p) => ({ ...p, [key]: e.target.checked }))}
                  className="size-4 accent-ink"
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="auto" className="text-sm font-medium">Pays without asking up to, ₱</label>
              <input id="auto" name="autoApprove" inputMode="decimal" autoComplete="off" defaultValue="5.00" className={FIELD} />
              <span className="min-h-[1lh] text-xs text-muted">Anything above asks you on your phone.</span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="daily" className="text-sm font-medium">Most per day, ₱</label>
              <input id="daily" name="daily" inputMode="decimal" autoComplete="off" defaultValue="20.00" className={FIELD} />
            </div>
          </div>
        </Row>
      </form>

      <aside aria-labelledby="sum-title" className="min-w-0 flex-[1_1_300px] rounded-xl border border-rule bg-surface p-6" aria-live="polite">
        {stage < 3 ? (
          <div className="flex flex-col gap-4">
            <h2 id="sum-title" className="text-lg font-medium">Before you create it</h2>
            <dl className="flex flex-col border-b border-rule">
              {[
                ["Most per payment", `₱${Number(cap || 0).toFixed(2)}`],
                ["Stops working on", expiry],
                ["Providers", String(providerCount)],
                ["Starting budget", "₱0.00"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-t border-rule py-2">
                  <dt className="text-ink-2">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <ol className="flex flex-col gap-3">
              {STEPS.map((s, i) => {
                const done = stage >= i + 2;
                const active = stage === i + 1;
                return (
                  <li key={s.title} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3">
                    <span className="mt-1">
                      {done ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-paid)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Done">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : active ? (
                        <Spinner label="In progress" />
                      ) : (
                        <span className="block size-4 rounded-full border border-edge" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-xs text-muted">{s.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? "Writing to Stellar…" : "Create agent"}
            </Button>
            <span className="text-xs text-muted">Two testnet transactions. Velo pays the fees.</span>
          </div>
        ) : (
          <div className="flex animate-rise flex-col gap-4">
            <h2 className="text-lg font-medium">{name.trim()} exists on Stellar</h2>
            <p role="alert" className="rounded-md bg-info-bg p-3 text-sm text-info">Save the secret below now. Settl shows it only once.</p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">AGENT_SECRET</span>
              <span className="overflow-x-auto whitespace-nowrap font-mono text-sm">SB••••••••••••••••••••Q7XK</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">AGENT_DEVICE_HASH</span>
              <span className="font-mono text-sm">9f2c41e0…b37d</span>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1">Copy both</Button>
              <Button className="flex-1">Download .env</Button>
            </div>
            <ButtonLink href="/buyer/agents/bookkeeper" variant="primary">Load its budget</ButtonLink>
            <button type="button" onClick={() => setStage(0)} className="min-h-10 font-medium underline">
              Reset the demo
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ title, body, last, children }: { title: string; body: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-wrap gap-x-10 gap-y-4 border-t border-rule py-6 ${last ? "border-b" : ""}`}>
      <div className="flex flex-[1_1_200px] flex-col gap-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-ink-2">{body}</p>
      </div>
      <div className="flex flex-[2_1_280px] flex-col gap-4">{children}</div>
    </div>
  );
}

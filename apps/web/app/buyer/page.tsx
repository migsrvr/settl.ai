import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ButtonLink, Meter, PageHeader, Pill, Stat } from "@/components/ui";
import { AGENTS } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

export const metadata: Metadata = { title: "Agents" };

export default function BuyerAgentsPage() {
  return (
    <AppShell role="buyer" active="/buyer">
      <PageHeader
        title="Agents"
        lead="Each agent spends from its own prepaid budget, inside limits you set once."
        actions={<ButtonLink href="/buyer/agents/new" variant="primary">Create an agent</ButtonLink>}
      />

      <section aria-label="Spending today" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6">
        <Stat label="Budget left" value="₱58.00" note="Of ₱70.00 loaded" />
        <Stat label="Spent today" value="₱12.00" note="6 paid calls" />
        <Stat label="Kept on failed results" value="₱2.00" note="1 result failed its checks" />
        <Stat label="Waiting on you" value="1" note={<Link href="/buyer/approvals/geoph">Review the GeoPH request</Link>} />
      </section>

      <section aria-labelledby="agents-title" className="flex flex-col gap-2">
        <h2 id="agents-title" className="text-lg font-medium">Your agents</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted">
                {["Agent", "Status", "Budget left", "Cap per payment", "Expires"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">
                    {h}
                  </th>
                ))}
                <th scope="col" className="whitespace-nowrap border-b border-rule py-2 text-right font-normal">Spent today</th>
              </tr>
            </thead>
            <tbody>
              {AGENTS.map((a) => {
                const active = a.status === "active";
                return (
                  <tr key={a.id} className={active ? "hover:bg-well" : "text-ink-2"}>
                    <td className="border-b border-rule py-4 pr-4">
                      {active ? (
                        <Link href={`/buyer/agents/${a.id}`} className="font-medium text-ink">
                          {a.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{a.name}</span>
                      )}
                      <div className="text-xs text-muted">{a.providers}</div>
                    </td>
                    <td className="border-b border-rule py-4 pr-4">
                      <Pill tone={active ? "paid" : "neutral"}>{active ? "Active" : "Revoked"}</Pill>
                    </td>
                    <td className="w-[200px] border-b border-rule py-4 pr-4">
                      <div>
                        <span className="font-medium">{formatPeso(a.left)}</span>
                        {active ? <span className="text-muted"> of {formatPeso(a.loaded)}</span> : null}
                      </div>
                      {active ? <Meter value={a.left} max={a.loaded} className="mt-1" /> : null}
                    </td>
                    <td className="border-b border-rule py-4 pr-4">{a.cap ? formatPeso(a.cap) : <span className="text-muted">Not set</span>}</td>
                    <td className="border-b border-rule py-4 pr-4 text-ink-2">{a.expires}</td>
                    <td className="border-b border-rule py-4 text-right font-medium">{formatPeso(a.spentToday)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm text-ink-2">
        Budgets are funded from your org wallet, <span className="font-mono text-ink">GD3K…9QZM</span>, which Settl manages on testnet.
      </p>
    </AppShell>
  );
}

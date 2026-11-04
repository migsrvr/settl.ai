import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ActivityTable } from "@/components/buyer/activity-table";
import { AgentBudget } from "@/components/buyer/agent-budget";
import { Button, Pill } from "@/components/ui";
import { AGENTS } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

export function generateStaticParams() {
  return AGENTS.filter((a) => a.status === "active").map((a) => ({ id: a.id }));
}

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: PageProps<"/buyer/agents/[id]">) {
  const { id } = await params;
  const agent = AGENTS.find((a) => a.id === id && a.status === "active");
  if (!agent) notFound();

  return (
    <AppShell role="buyer" active="/buyer/agents/bookkeeper" crumbs={[{ href: "/buyer", label: "Agents" }, { label: agent.name }]}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{agent.name}</h1>
            <Pill tone="paid">Active</Pill>
          </div>
          <span className="font-mono text-xs text-muted">agt_9f2c41e0, wallet GAGT…7KQ2</span>
        </div>
        <Button variant="danger">Revoke agent</Button>
      </div>

      <div className="flex flex-wrap items-start gap-10">
        <AgentBudget left={agent.left} loaded={agent.loaded} />

        <section aria-labelledby="lim-title" className="flex min-w-0 flex-[1_1_300px] flex-col">
          <div className="flex items-center justify-between pb-2">
            <h2 id="lim-title" className="text-lg font-medium">Limits</h2>
            <Button size="sm">Edit limits</Button>
          </div>
          <h3 className="border-t border-rule pb-1 pt-3 text-xs font-normal text-muted">Enforced on Stellar</h3>
          <dl>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">Most per payment</dt>
              <dd className="font-medium">{agent.cap ? formatPeso(agent.cap) : "Not set"}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">Stops working on</dt>
              <dd className="font-medium">{agent.expires}</dd>
            </div>
          </dl>
          <h3 className="border-t border-rule pb-1 pt-3 text-xs font-normal text-muted">Checked by Settl</h3>
          <dl className="border-b border-rule">
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">Providers</dt>
              <dd className="font-medium">ResiboAI, GeoPH</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">Pays without asking</dt>
              <dd className="font-medium">Up to ₱5.00</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">Most per day</dt>
              <dd className="font-medium">₱20.00</dd>
            </div>
          </dl>
        </section>
      </div>

      <ActivityTable />
    </AppShell>
  );
}

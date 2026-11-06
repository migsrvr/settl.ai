import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ActivityTable } from '@/components/buyer/activity-table';
import { AgentBudget } from '@/components/buyer/agent-budget';
import { AgentControls } from '@/components/buyer/live-agent-controls';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money, sum, today, when } from '@/components/buyer/live-money';
import { Pill } from '@/components/ui';
import { loadBuyerDashboard } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Agent' };
export function generateStaticParams() { return [{ id: 'bookkeeper' }]; }
async function LiveAgent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadBuyerDashboard();
  if (!data) return <DashboardUnavailable/>;
  const agent = data.agents.find(a => a.id === id);
  if (!agent) return <section><h1 className="font-display text-2xl font-bold">Agent unavailable</h1><p>This agent does not belong to your workspace or no longer exists.</p></section>;
  const calls = data.calls.filter(c => c.agentId === agent.id);
  const spent = sum(calls.filter(c => c.status === 'paid' && c.confirmedAt && today(c.confirmedAt)).map(c => c.amountStroops));
  const limits = agent.policy ? [
    ['Most per payment', money(agent.policy.cap, data.rateCents)],
    ['Stops working on', when(agent.policy.expiresAt)],
    ['Pays without asking', money(agent.policy.auto, data.rateCents)],
    ['Most per day', money(agent.policy.daily, data.rateCents)],
    ['Providers', agent.policy.allowlist.length ? agent.policy.allowlist.map(id => data.providers.find(p => p.id === id)?.displayName ?? id).join(', ') : 'No providers allowed'],
  ] : [];
  return <>
    <header className="flex flex-col gap-3"><div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-2xl font-bold">{agent.name}</h1><Pill tone={agent.status === 'active' ? 'paid' : 'neutral'}>{agent.status}</Pill></div><p className="break-all font-mono text-sm">{agent.id}</p><p className="break-all font-mono text-sm">Wallet {agent.agentPublic}</p></header>
    <div className="flex flex-wrap items-start gap-10">
      <AgentBudget agentId={agent.id} balance={agent.balance} rateCents={data.rateCents} topups={agent.topups} spentToday={spent} heldStroops={agent.heldStroops} active={agent.status === 'active'}/>
      <section className="flex min-w-0 flex-[1_1_300px] flex-col gap-4"><h2 className="text-lg font-medium">Limits</h2>
        {agent.policy ? <dl>{limits.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-3 border-t border-rule py-3"><dt>{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl> : <p>No spending policy is stored.</p>}
        <AgentControls agent={agent} providers={data.providers} rateCents={data.rateCents}/>
      </section>
    </div>
    <ActivityTable calls={calls} approvals={data.approvals.filter(a => a.agentId === agent.id)} rateCents={data.rateCents}/>
  </>;
}
export default function AgentPage({ params }: PageProps<'/buyer/agents/[id]'>) {
  return <AppShell role="buyer" active="/buyer" crumbs={[{ href: '/buyer', label: 'Agents' }, { label: 'Agent' }]}><Suspense fallback={<DashboardLoading/>}><LiveAgent params={params}/></Suspense></AppShell>;
}

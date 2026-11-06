import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ActivityTable } from '@/components/buyer/activity-table';
import { ButtonLink, PageHeader, Pill, Stat } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money, sum, today, when } from '@/components/buyer/live-money';
import { loadBuyerDashboard } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Agents' };
async function LiveAgents({ searchParams }: Pick<PageProps<'/buyer'>, 'searchParams'>) {
  const data = await loadBuyerDashboard();
  if (!data) return <DashboardUnavailable/>;
  const spent = data.calls.filter(c => c.status === 'paid' && c.confirmedAt && today(c.confirmedAt));
  const failed = data.calls.filter(c => c.status === 'not_charged' && today(c.time));
  const known = data.agents.every(a => a.balance.amountStroops !== null);
  const totalBalance = known ? sum(data.agents.map(a => a.balance.amountStroops!)) : null;
  const includesCache = data.agents.some(a => a.balance.source === 'cache');
  const query = (await searchParams).q;
  const q = (typeof query === 'string' ? query : '').trim().slice(0, 200).toLowerCase();
  if (q) {
    const matchingCalls = data.calls.filter(c => [c.id, c.agentId, c.agent, c.customer, c.provider, c.endpoint, c.txHash ?? ''].some(value => value.toLowerCase().includes(q)));
    const agentIds = new Set(matchingCalls.map(c => c.agentId));
    data.agents = data.agents.filter(a => [a.id, a.name, a.agentPublic].some(value => value.toLowerCase().includes(q)) || agentIds.has(a.id));
    data.calls = matchingCalls;
  }
  return <>
    {q && <p role="status">Agents and activity matching “{q}”. Summary totals cover your full workspace.</p>}
    <section aria-label="Spending today" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6">
      <Stat label="Budget left" value={money(totalBalance, data.rateCents)} note={includesCache ? 'Includes stale cached balances' : 'Stellar testnet escrow balances'}/>
      <Stat label="Spent today (UTC)" value={money(sum(spent.map(c => c.amountStroops)), data.rateCents)} note={`${spent.length} confirmed paid calls`}/>
      <Stat label="Not charged on failed results" value={money(sum(failed.map(c => c.quotedStroops)), data.rateCents)} note={`${failed.length} results not charged`}/>
      <Stat label="Waiting on you" value={String(data.approvals.length)} note={data.approvals[0] ? <Link href={`/buyer/approvals/${encodeURIComponent(data.approvals[0].id)}`}>Review request</Link> : 'No pending approvals'}/>
    </section>
    <section>
      <h2 className="mb-3 text-lg font-medium">Your agents</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
        <thead><tr className="text-left text-muted">{['Agent', 'Status', 'Budget left', 'Cap per payment', 'Expires (UTC)', 'Spent today (UTC)'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{data.agents.map(a => <tr key={a.id}>
          <td className="border-b border-rule py-4 pr-4"><Link className="font-medium" href={`/buyer/agents/${encodeURIComponent(a.id)}`}>{a.name}</Link></td>
          <td className="border-b border-rule py-4 pr-4"><Pill tone={a.status === 'active' ? 'paid' : a.status === 'error' ? 'blocked' : 'neutral'}>{a.status}</Pill></td>
          <td className="border-b border-rule py-4 pr-4">{money(a.balance.amountStroops, data.rateCents)}{a.balance.source === 'cache' && <div className="text-muted">Stale as of {when(a.balance.asOf!)}</div>}</td>
          <td className="border-b border-rule py-4 pr-4">{a.policy ? money(a.policy.cap, data.rateCents) : 'Not set'}</td>
          <td className="border-b border-rule py-4 pr-4">{a.policy ? when(a.policy.expiresAt) : 'Not set'}</td>
          <td className="border-b border-rule py-4">{money(sum(spent.filter(c => c.agentId === a.id).map(c => c.amountStroops)), data.rateCents)}</td>
        </tr>)}</tbody>
      </table></div>
      {data.agents.length === 0 && <p className="py-4">No agents yet. Create an agent to get started.</p>}
    </section>
    <div id="activity"><ActivityTable calls={data.calls} approvals={data.approvals} rateCents={data.rateCents}/></div>
    <p className="break-all text-ink-2">Organization wallet: <span className="font-mono text-sm">{data.walletPublic}</span></p>
  </>;
}
export default function BuyerAgentsPage({ searchParams }: PageProps<'/buyer'>) {
  return <AppShell role="buyer" active="/buyer"><PageHeader title="Agents" lead="Each agent spends from its own prepaid budget, inside limits you set once." actions={<ButtonLink href="/buyer/agents/new" variant="primary">Create an agent</ButtonLink>}/><Suspense fallback={<DashboardLoading/>}><LiveAgents searchParams={searchParams}/></Suspense></AppShell>;
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ActivityTable } from '@/components/buyer/activity-table';
import { ButtonLink, PageHeader, Pill, Stat } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money, when } from '@/components/buyer/live-money';
import { loadBuyerHome } from '@/lib/server/dashboard';
import { LiveBalance, LiveBudgetTotal } from '@/components/buyer/live-balance';
import { HistoryPagination } from '@/components/buyer/history-pagination';
export const metadata: Metadata = { title: 'Agents' };
async function LiveAgents({ searchParams }: Pick<PageProps<'/buyer'>, 'searchParams'>) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : undefined;
  const historyQuery = new URLSearchParams(); if (q) historyQuery.set('q', q); if (status) historyQuery.set('status', status);
  const data = await loadBuyerHome({ q, status, cursor: typeof params.cursor === 'string' ? params.cursor : undefined });
  if (!data) return <DashboardUnavailable/>;
  const agents = data.matchingAgentIds === null ? data.agents : data.agents.filter(a => data.matchingAgentIds!.includes(a.id));
  return <>
    {q && <p role="status">Agents and activity matching “{q}”. Summary totals cover your full workspace.</p>}
    <section aria-label="Spending today" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6">
      <div><p className="text-muted">Budget left</p><div className="font-display text-3xl font-bold"><LiveBudgetTotal agents={data.agents} rateCents={data.rateCents}/></div><p className="text-muted">Observed Stellar testnet escrow balances</p></div>
      <Stat label="Spent today (UTC)" value={money(data.stats.spentToday, data.rateCents)} note={`${data.stats.paidCalls} confirmed paid calls`}/>
      <Stat label="Not charged on failed results" value={money(data.stats.notChargedStroops, data.rateCents)} note={`${data.stats.notChargedCount} results not charged`}/>
      <Stat label="Waiting on you" value={String(data.approvals.length)} note={data.approvals[0] ? <Link href={`/buyer/approvals/${encodeURIComponent(data.approvals[0].id)}`}>Review request</Link> : 'No pending approvals'}/>
    </section>
    <section>
      <h2 className="mb-3 text-lg font-medium">Your agents</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
        <thead><tr className="text-left text-muted">{['Agent', 'Status', 'Budget left', 'Cap per payment', 'Expires (UTC)', 'Spent today (UTC)'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{agents.map(a => <tr key={a.id}>
          <td className="border-b border-rule py-4 pr-4"><Link className="font-medium" href={`/buyer/agents/${encodeURIComponent(a.id)}`}>{a.name}</Link></td>
          <td className="border-b border-rule py-4 pr-4"><Pill tone={a.status === 'active' ? 'paid' : a.status === 'error' ? 'blocked' : 'neutral'}>{a.status}</Pill></td>
          <td className="border-b border-rule py-4 pr-4"><LiveBalance url={`/api/agents/${encodeURIComponent(a.id)}/balance`} initial={a.balance} rateCents={data.rateCents}/></td>
          <td className="border-b border-rule py-4 pr-4">{a.policy ? money(a.policy.cap, data.rateCents) : 'Not set'}</td>
          <td className="border-b border-rule py-4 pr-4">{a.policy ? when(a.policy.expiresAt) : 'Not set'}</td>
          <td className="border-b border-rule py-4">{money(a.spentToday, data.rateCents)}</td>
        </tr>)}</tbody>
      </table></div>
      {agents.length === 0 && <p className="py-4">No agents yet. Create an agent to get started.</p>}
    </section>
    <div id="activity"><ActivityTable calls={data.calls} approvals={data.approvals} rateCents={data.rateCents} historyUrl={`/api/buyer/calls?${historyQuery}`} status={status} pagePath="/buyer" query={{ q, status }}/></div>
    <HistoryPagination path="/buyer" nextCursor={data.nextCursor} query={{ q, status }} label="Next 25 calls"/>
    <p className="break-all text-ink-2">Organization wallet: <span className="font-mono text-sm">{data.walletPublic}</span></p>
  </>;
}
export default function BuyerAgentsPage({ searchParams }: PageProps<'/buyer'>) {
  return <AppShell role="buyer" active="/buyer"><PageHeader title="Agents" lead="Each agent spends from its own prepaid budget, inside limits you set once." actions={<ButtonLink href="/buyer/agents/new" variant="primary">Create an agent</ButtonLink>}/><Suspense fallback={<DashboardLoading/>}><LiveAgents searchParams={searchParams}/></Suspense></AppShell>;
}

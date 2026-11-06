import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ClaimPanel } from '@/components/provider/claim-panel';
import { PageHeader } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money, sum, today } from '@/components/buyer/live-money';
import { loadProviderDashboard } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Earnings' };
async function LiveEarnings() {
  const data = await loadProviderDashboard(); if (!data) return <DashboardUnavailable/>;
  const paid = data.calls.filter(c => c.status === 'paid' && c.confirmedAt !== null); const customers = new Map<string, { name: string; agent: string; amounts: string[] }>();
  paid.filter(c => c.confirmedAt && today(c.confirmedAt)).forEach(c => { const customer = customers.get(c.agentId) ?? { name: c.customer, agent: c.agent, amounts: [] }; customer.amounts.push(c.amountStroops); customers.set(c.agentId, customer); });
  return <><ClaimPanel {...data} earnedStroops={sum(paid.map(c => c.amountStroops))}/><section><h2 className="mb-3 text-lg font-medium">Who paid you today (UTC)</h2><div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr className="text-left text-muted">{['Customer', 'Agent', 'Paid calls', 'Earned'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead><tbody>{[...customers].map(([id, c]) => <tr key={id}><td className="border-b border-rule py-4 pr-4">{c.name}</td><td className="border-b border-rule py-4 pr-4">{c.agent}</td><td className="border-b border-rule py-4 pr-4">{c.amounts.length}</td><td className="border-b border-rule py-4">{money(sum(c.amounts), data.rateCents)}</td></tr>)}</tbody></table></div>{customers.size === 0 && <p className="py-4">No confirmed customer payments today.</p>}</section></>;
}
export default function EarningsPage() { return <AppShell role="provider" active="/provider/earnings"><PageHeader title="Earnings" lead="What agents pay you waits in escrow until you claim it to your wallet."/><Suspense fallback={<DashboardLoading/>}><LiveEarnings/></Suspense></AppShell>; }

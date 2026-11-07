import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { ClaimPanel } from '@/components/provider/claim-panel';
import { PageHeader } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money } from '@/components/buyer/live-money';
import { loadProviderEarnings } from '@/lib/server/dashboard';
import { HistoryPagination } from '@/components/buyer/history-pagination';
export const metadata: Metadata = { title: 'Earnings' };
async function LiveEarnings({ searchParams }: Pick<PageProps<'/provider/earnings'>, 'searchParams'>) {
  const params = await searchParams;
  const data = await loadProviderEarnings({ cursor: typeof params.cursor === 'string' ? params.cursor : undefined }); if (!data) return <DashboardUnavailable/>;
  const customers = data.customers;
  return <><ClaimPanel {...data} earnedStroops={data.earnedStroops}/><HistoryPagination path="/provider/earnings" nextCursor={data.nextCursor} label="Next 25 claims"/><section><h2 className="mb-3 text-lg font-medium">Who paid you today (UTC)</h2><div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr className="text-left text-muted">{['Customer', 'Agent', 'Paid calls', 'Earned'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead><tbody>{customers.map(c => <tr key={c.id}><td className="border-b border-rule py-4 pr-4">{c.name}</td><td className="border-b border-rule py-4 pr-4">{c.agent}</td><td className="border-b border-rule py-4 pr-4">{c.count}</td><td className="border-b border-rule py-4">{money(c.amountStroops, data.rateCents)}</td></tr>)}</tbody></table></div>{customers.length === 0 && <p className="py-4">No confirmed customer payments today.</p>}</section></>;
}
export default function EarningsPage({ searchParams }: PageProps<'/provider/earnings'>) { return <AppShell role="provider" active="/provider/earnings"><PageHeader title="Earnings" lead="What agents pay you waits in escrow until you claim it to your wallet."/><Suspense fallback={<DashboardLoading/>}><LiveEarnings searchParams={searchParams}/></Suspense></AppShell>; }

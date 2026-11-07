import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { CallsPanel } from '@/components/provider/calls-panel';
import { ButtonLink, PageHeader, Stat } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money } from '@/components/buyer/live-money';
import { loadProviderHome } from '@/lib/server/dashboard';
import { LiveBalance } from '@/components/buyer/live-balance';
import { HistoryPagination } from '@/components/buyer/history-pagination';
export const metadata: Metadata = { title: 'Home' };
async function LiveHome({ searchParams }: Pick<PageProps<'/provider'>, 'searchParams'>) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : undefined;
  const historyQuery = new URLSearchParams(); if (q) historyQuery.set('q', q); if (status) historyQuery.set('status', status);
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
  const data = await loadProviderHome({ q, cursor, status }); if (!data) return <DashboardUnavailable/>;
  const { hourly, failures } = data.stats;
  const maximum = BigInt(hourly[23]); const points = hourly.map((amount, hour) => `${hour * 600 / 23},${maximum > 0n ? 150 - Number(BigInt(amount) * 140n / maximum) : 150}`).join(' ');
  return <><section aria-label="Today in numbers (UTC)" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6"><Stat label="Earned today (UTC)" value={money(data.stats.earnedToday, data.rateCents)}/><Stat label="Paid calls" value={String(data.stats.paidCalls)}/><Stat label="Not charged" value={String(data.stats.notCharged)}/><Stat label="Verification pass rate" value={data.stats.verified ? `${(data.stats.passed * 100 / data.stats.verified).toFixed(1)}%` : 'No checks yet'} note={`${data.stats.passed} passed of ${data.stats.verified} verified results`}/></section><div className="flex flex-wrap gap-10"><section className="min-w-0 flex-[999_1_480px]"><h2 className="mb-4 text-lg font-medium">Confirmed earnings today (UTC)</h2><svg viewBox="0 0 600 160" width="100%" height="160" role="img" aria-label={`Cumulative confirmed earnings today: ${money(hourly[23], data.rateCents)}`}><polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="2"/></svg><div className="flex justify-between text-muted"><span>00:00 UTC</span><span>23:00 UTC</span></div></section><section className="flex min-w-0 flex-[1_1_280px] flex-col gap-3"><h2 className="text-lg font-medium">Waiting in escrow</h2><LiveBalance url="/api/provider/balance" initial={data.pending} rateCents={data.rateCents}/><ButtonLink href="/provider/earnings">Claim earnings</ButtonLink></section></div><section><h2 className="mb-3 text-lg font-medium">Failed checks, last 7 days</h2>{failures.length === 0 ? <p>No failed checks recorded.</p> : failures.map(({ check, count }) => <p key={check} className="flex justify-between border-b border-rule py-2"><span>{check}</span><span>{count}</span></p>)}</section><CallsPanel calls={data.calls} rateCents={data.rateCents} historyUrl={`/api/provider/calls?${historyQuery}`} status={status} pagePath="/provider" query={{ q, status }}/><HistoryPagination path="/provider" nextCursor={data.nextCursor} query={{ q, status }} label="Next 25 calls"/></>;
}
export default function ProviderHome({ searchParams }: PageProps<'/provider'>) { return <AppShell role="provider" active="/provider"><PageHeader title="Today" actions={<ButtonLink href="/provider/endpoints" variant="primary">Manage endpoints</ButtonLink>}/><Suspense fallback={<DashboardLoading/>}><LiveHome searchParams={searchParams}/></Suspense></AppShell>; }

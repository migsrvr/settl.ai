import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { CallsPanel } from '@/components/provider/calls-panel';
import { ButtonLink, PageHeader, Stat } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money, sum, today } from '@/components/buyer/live-money';
import { loadProviderDashboard } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Home' };
function getFailures(calls: { time: string | Date; checks: { check: string; ok: boolean }[] }[]) {
  const cutoff = Date.now() - 7 * 86_400_000;
  const failures = new Map<string, number>();
  calls.filter(c => new Date(c.time).getTime() >= cutoff).flatMap(c => c.checks).filter(c => !c.ok).forEach(c => failures.set(c.check, (failures.get(c.check) ?? 0) + 1));
  return failures;
}
async function LiveHome({ searchParams }: Pick<PageProps<'/provider'>, 'searchParams'>) {
  const data = await loadProviderDashboard(); if (!data) return <DashboardUnavailable/>;
  const calls = data.calls.filter(c => today(c.confirmedAt ?? c.time)); const paid = calls.filter(c => c.status === 'paid' && c.confirmedAt !== null); const checked = calls.filter(c => c.verification !== null); const passed = checked.filter(c => c.verification === 'pass');
  const hourly = Array.from({ length: 24 }, (_, hour) => sum(paid.filter(c => new Date(c.confirmedAt ?? c.time).getUTCHours() <= hour).map(c => c.amountStroops)));
  const maximum = BigInt(hourly[23]); const points = hourly.map((amount, hour) => `${hour * 600 / 23},${maximum > 0n ? 150 - Number(BigInt(amount) * 140n / maximum) : 150}`).join(' ');
  const failures = getFailures(data.calls);
  const query = (await searchParams).q;
  const q = (typeof query === 'string' ? query : '').trim().slice(0, 200).toLowerCase();
  if (q) data.calls = data.calls.filter(c => [c.id, c.agentId, c.agent, c.customer, c.provider, c.endpoint, c.txHash ?? ''].some(value => value.toLowerCase().includes(q)));
  return <><section aria-label="Today in numbers (UTC)" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6"><Stat label="Earned today (UTC)" value={money(sum(paid.map(c => c.amountStroops)), data.rateCents)}/><Stat label="Paid calls" value={String(paid.length)}/><Stat label="Not charged" value={String(calls.filter(c => c.status === 'not_charged').length)}/><Stat label="Verification pass rate" value={checked.length ? `${(passed.length * 100 / checked.length).toFixed(1)}%` : 'No checks yet'} note={`${passed.length} passed of ${checked.length} verified results`}/></section><div className="flex flex-wrap gap-10"><section className="min-w-0 flex-[999_1_480px]"><h2 className="mb-4 text-lg font-medium">Confirmed earnings today (UTC)</h2><svg viewBox="0 0 600 160" width="100%" height="160" role="img" aria-label={`Cumulative confirmed earnings today: ${money(hourly[23], data.rateCents)}`}><polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="2"/></svg><div className="flex justify-between text-muted"><span>00:00 UTC</span><span>23:00 UTC</span></div></section><section className="flex min-w-0 flex-[1_1_280px] flex-col gap-3"><h2 className="text-lg font-medium">Waiting in escrow</h2><p className="text-2xl font-medium">{money(data.pending.amountStroops, data.rateCents)}</p><p>{data.pending.source === 'chain' ? 'Observed on Stellar testnet' : 'Chain balance unavailable'}</p><ButtonLink href="/provider/earnings">Claim earnings</ButtonLink></section></div><section><h2 className="mb-3 text-lg font-medium">Failed checks, last 7 days</h2>{failures.size === 0 ? <p>No failed checks recorded.</p> : [...failures].sort((a, b) => b[1] - a[1]).map(([check, count]) => <p key={check} className="flex justify-between border-b border-rule py-2"><span>{check}</span><span>{count}</span></p>)}</section><CallsPanel calls={data.calls} rateCents={data.rateCents}/></>;
}
export default function ProviderHome({ searchParams }: PageProps<'/provider'>) { return <AppShell role="provider" active="/provider"><PageHeader title="Today" actions={<ButtonLink href="/provider/endpoints" variant="primary">Manage endpoints</ButtonLink>}/><Suspense fallback={<DashboardLoading/>}><LiveHome searchParams={searchParams}/></Suspense></AppShell>; }

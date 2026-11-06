'use client';
import Link from 'next/link';
import { CallsPanel } from '@/components/provider/calls-panel';
import type { BuyerDashboard, LiveCall } from '@/lib/server/dashboard';
import { money } from './live-money';
export function ActivityTable({ calls, approvals, rateCents }: { calls: LiveCall[]; approvals: BuyerDashboard['approvals']; rateCents: string | null }) {
  return <div className="flex flex-col gap-6">
    <section id="approvals" aria-label="Pending approvals" className="flex flex-col gap-3"><h2 className="text-lg font-medium">Waiting on you</h2>{approvals.length === 0 && <p>No pending approvals.</p>}{approvals.map(a => <Link key={a.id} href={`/buyer/approvals/${encodeURIComponent(a.id)}`} className="border-b border-rule py-3 font-medium">Review {a.provider} request for {money(a.amountStroops, rateCents)}</Link>)}</section>
    <CallsPanel title="Activity" calls={calls} rateCents={rateCents}/>
  </div>;
}

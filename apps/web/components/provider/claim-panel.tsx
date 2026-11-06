'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { money, txUrl, when } from '@/components/buyer/live-money';
import type { ProviderDashboard } from '@/lib/server/dashboard';
export function ClaimPanel({ pending, merchantWallet, claims, rateCents, earnedStroops, settings }: Pick<ProviderDashboard, 'pending' | 'merchantWallet' | 'claims' | 'rateCents' | 'settings'> & { earnedStroops: string }) {
  const router = useRouter(); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [locked, setLocked] = useState(false); const [hash, setHash] = useState<string | null>(null);
  const hasPending = claims.some(c => c.status === 'pending');
  async function claim() {
    if (busy || locked || hasPending) return; setBusy(true); setConfirm(false); setMessage('');
    try {
      const response = await fetch('/api/provider/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json(); if (!response.ok) throw new Error();
      if (result.status === 'completed') { setMessage('Claim completed on Stellar. Refresh balances to see the latest escrow state.'); setLocked(true); }
      else if (result.status === 'pending') { setMessage('Claim pending. Its transaction must be reconciled before another claim.'); setLocked(true); }
      else if (result.status === 'skipped') setMessage('No claim was submitted. Refresh balances and review pending claims.');
      else setMessage('Claim failed. Review the claim history before trying again.');
      if (typeof result.txHash === 'string') setHash(result.txHash); router.refresh();
    } catch { setLocked(true); setMessage('The claim result is unavailable. Refresh and review claim history before trying again.'); router.refresh(); }
    finally { setBusy(false); }
  }
  return <>
    <section aria-labelledby="pending-title" className="flex flex-wrap gap-6 rounded-xl border border-rule bg-surface p-6">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4"><h2 id="pending-title" className="text-base text-muted">Waiting in escrow</h2><strong className="font-display text-4xl">{money(pending.amountStroops, rateCents)}</strong><p className="text-ink-2">{pending.source === 'chain' ? 'Observed on Stellar testnet' : 'Chain balance unavailable. Refresh to try again.'}</p><dl><dt>Confirmed earnings in total</dt><dd className="font-medium">{money(earnedStroops, rateCents)}</dd></dl><p className="break-all font-mono text-sm">{merchantWallet}</p><p>{settings?.enabled ? `Auto-claim enabled at ${money(settings.threshold, rateCents)}.` : 'Auto-claim is disabled.'}</p></div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col justify-center gap-4">
        {confirm ? <div className="flex flex-col gap-3"><h3 className="text-lg font-medium">Claim all pending earnings?</h3><p>This moves all pending payments to your merchant wallet.</p><div className="flex flex-wrap gap-2"><Button onClick={() => setConfirm(false)}>Keep in escrow</Button><Button variant="primary" onClick={claim}>Confirm claim</Button></div></div> : <Button variant="primary" disabled={busy || locked || hasPending || pending.amountStroops === null || BigInt(pending.amountStroops) === 0n} onClick={() => setConfirm(true)}>{busy ? 'Submitting claim…' : `Claim ${money(pending.amountStroops, rateCents)}`}</Button>}
        {hasPending && <p role="status">Claim pending. Another claim cannot be submitted yet.</p>}<p role="status" aria-live="polite">{message}</p>{hash && <a className="break-all font-mono text-sm" href={txUrl(hash)}>{hash}</a>}<Button onClick={() => router.refresh()}>Refresh balances</Button>
      </div>
    </section>
    <section className="flex flex-col gap-3"><h2 className="text-lg font-medium">Claim history</h2><p className="text-ink-2">Amounts are pending earnings observed before submission, not exact payout receipts.</p><div className="overflow-x-auto"><table className="w-full min-w-[620px]"><thead><tr className="text-left text-muted">{['Submitted (UTC)', 'Observed amount', 'Status', 'Transaction'].map(h => <th scope="col" key={h} className="border-b border-rule p-2 font-normal">{h}</th>)}</tr></thead><tbody>{claims.map(c => <tr key={c.id}><td className="border-b border-rule p-2">{when(c.createdAt)}</td><td className="border-b border-rule p-2">{money(c.amountStroops, rateCents)}</td><td className="border-b border-rule p-2">{c.status}</td><td className="border-b border-rule p-2">{c.txHash ? <a className="break-all font-mono text-sm" href={txUrl(c.txHash)}>{c.txHash}</a> : 'No transaction recorded'}</td></tr>)}</tbody></table></div>{claims.length === 0 && <p>No claims recorded.</p>}</section>
  </>;
}

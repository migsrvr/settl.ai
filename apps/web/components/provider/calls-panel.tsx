'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Pill, Button, type Tone } from '@/components/ui';
import type { LiveCall } from '@/lib/server/dashboard';
import { money, txUrl, when } from '@/components/buyer/live-money';
const statuses: Record<string, { label: string; tone: Tone }> = { paid: { label: 'Paid', tone: 'paid' }, not_charged: { label: 'Not charged', tone: 'neutral' }, blocked: { label: 'Blocked', tone: 'blocked' }, failed: { label: 'Failed', tone: 'blocked' }, pending: { label: 'Pending', tone: 'info' } };
function TabBar({ value, onChange }: { value: string; onChange: (value: string) => void; label: string; tabs: { id: string; label: string }[] }) {
  return <div role="group" aria-label="Filter calls" className="flex gap-6 overflow-x-auto border-b border-rule">{[{ id: 'all', label: 'All' }, ...Object.entries(statuses).map(([id, s]) => ({ id, label: s.label }))].map(item => <button type="button" key={item.id} aria-pressed={value === item.id} onClick={() => onChange(item.id)} className={`min-h-10 whitespace-nowrap border-b-2 ${value === item.id ? 'border-ink font-medium' : 'border-transparent text-muted'}`}>{item.label}</button>)}</div>;
}
export function CallsPanel({ calls, rateCents, title = 'Recent calls', historyUrl, status, pagePath = '/provider', query = {} }: { calls: LiveCall[]; rateCents: string | null; title?: string; historyUrl?: string; status?: string; pagePath?: string; query?: Record<string, string | undefined> }) {
  const [localFilter, setFilter] = useState('all'); const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false); const [exportMessage, setExportMessage] = useState(''); const [exportError, setExportError] = useState('');
  const filter = historyUrl ? status || 'all' : localFilter;
  const rows = historyUrl ? calls : calls.filter(c => filter === 'all' || c.status === filter); const call = rows.find(c => c.id === selected);
  function filterHref(value: string) {
    const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value && key !== 'cursor' && key !== 'status') params.set(key, value); });
    if (value !== 'all') params.set('status', value);
    return `${pagePath}${params.size ? `?${params}` : ''}`;
  }
  async function exportCsv() {
    if (exporting) return;
    setExporting(true); setExportError(''); setExportMessage('Preparing CSV…');
    try {
      let records = rows;
      if (historyUrl) {
        records = [];
        const params = new URLSearchParams(historyUrl.split('?')[1]); params.delete('cursor');
        const path = historyUrl.split('?')[0]; let cursor: string | null = null;
        const visited = new Set<string>();
        do {
          if (cursor) { if (visited.has(cursor)) throw new Error(); visited.add(cursor); params.set('cursor', cursor); }
          const response = await fetch(`${path}${params.size ? `?${params}` : ''}`, { cache: 'no-store' });
          if (!response.ok) throw new Error();
          const page: { calls: LiveCall[]; nextCursor: string | null } = await response.json();
          if (!Array.isArray(page.calls) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error();
          records.push(...page.calls); cursor = page.nextCursor; setExportMessage(`Preparing CSV: ${records.length} calls loaded…`);
        } while (cursor);
      }
      const csv = [['ID', 'Status', 'Charged stroops', 'Quoted stroops', 'Agent', 'Provider', 'Endpoint', 'Submitted UTC', 'Transaction'], ...records.map(c => [c.id, c.status, c.amountStroops, c.quotedStroops, c.agent, c.provider, c.endpoint, c.time, c.txHash ?? ''])].map(row => row.map(value => `"${(/^[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = 'settl-calls.csv'; link.click(); URL.revokeObjectURL(url);
      setExportMessage(`CSV ready: ${records.length} calls.`);
    } catch { setExportMessage(''); setExportError('Export failed. Try exporting again when the connection is available.'); }
    finally { setExporting(false); }
  }
  return <section aria-label={title} className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-lg font-medium">{title}</h2><Button onClick={() => void exportCsv()} disabled={exporting || rows.length === 0}>{exporting ? 'Exporting CSV…' : 'Export CSV'}</Button></div>{exportMessage && <p role="status">{exportMessage}</p>}{exportError && <p role="alert">{exportError}</p>}{historyUrl ? <nav aria-label="Filter calls" className="flex gap-6 overflow-x-auto border-b border-rule">{[{ id: 'all', label: 'All' }, ...Object.entries(statuses).map(([id, item]) => ({ id, label: item.label }))].map(item => <Link key={item.id} href={filterHref(item.id)} aria-current={filter === item.id ? 'page' : undefined} className={`inline-flex min-h-10 items-center whitespace-nowrap border-b-2 ${filter === item.id ? 'border-ink font-medium' : 'border-transparent text-muted'}`}>{item.label}</Link>)}</nav> : <TabBar label="Filter calls" tabs={[]} value={filter} onChange={setFilter}/>}<div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse"><thead><tr className="text-left text-muted">{['Charged', 'Status', 'Agent / customer', 'Provider / endpoint', 'Submitted (UTC)', 'Details'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead><tbody>{rows.map(c => <tr key={c.id}><td className="border-b border-rule py-4 pr-4 font-medium">{money(c.amountStroops, rateCents)}</td><td className="border-b border-rule py-4 pr-4"><Pill tone={statuses[c.status]?.tone ?? 'neutral'}>{statuses[c.status]?.label ?? c.status}</Pill></td><td className="border-b border-rule py-4 pr-4">{c.agent}<div className="text-muted">{c.customer}</div></td><td className="border-b border-rule py-4 pr-4">{c.provider}<div className="font-mono text-sm">{c.endpoint}</div></td><td className="border-b border-rule py-4 pr-4">{when(c.time)}</td><td className="border-b border-rule py-4"><Button aria-expanded={selected === c.id} onClick={() => setSelected(selected === c.id ? null : c.id)}>View call</Button></td></tr>)}</tbody></table></div>{rows.length === 0 && <p>No calls match this filter.</p>}
    {call && <section aria-label="Call details" className="flex flex-col gap-3 border-y border-rule py-6"><h3 className="text-lg font-medium">{call.endpoint}</h3><p>Quoted {money(call.quotedStroops, rateCents)}. Charged {money(call.amountStroops, rateCents)}.</p><p>Verification: {call.verification ?? 'No verification recorded'}</p>{call.checks.length > 0 ? <ul>{call.checks.map(c => <li key={c.check} className="border-t border-rule py-2">{c.check}: {c.ok ? 'Passed' : 'Failed'}{c.note ? `, ${c.note}` : ''}</li>)}</ul> : <p>No result checks recorded.</p>}{call.txHash ? <a href={txUrl(call.txHash)} className="break-all font-mono text-sm">{call.txHash}</a> : <p>No transaction recorded.</p>}</section>}
  </section>;
}

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CallsPanel } from './calls-panel';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('offers keyboard-focusable status filters and an honest empty state', () => {
  render(<CallsPanel rateCents="1500" calls={[]}/>);
  const filter = screen.getByRole('button', { name: 'Paid' }); filter.focus(); expect(document.activeElement).toBe(filter); expect(filter.tabIndex).toBe(0); expect(screen.getByText('No calls match this filter.')).toBeTruthy(); expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
});
it('filters live statuses and shows the actual failed verification without inventing a transaction', () => {
  render(<CallsPanel rateCents="1500" calls={[{ id: 'call', agentId: 'owned', endpointId: 'ocr', agent: 'Agent', customer: 'Customer', provider: 'Provider', endpoint: '/ocr', status: 'not_charged', amountStroops: '0', quotedStroops: '10000000', time: '2026-11-06T00:00:00Z', confirmedAt: null, txHash: null, verification: 'fail', checks: [{ check: 'confidence', ok: false, note: 'Too low' }] }]}/>);
  fireEvent.click(screen.getByRole('button', { name: 'View call' })); expect(screen.getByText('confidence: Failed, Too low')).toBeTruthy(); expect(screen.getByText('No transaction recorded.')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Paid' })); expect(screen.getByText('No calls match this filter.')).toBeTruthy();
});
it('routes status filters across the full history while preserving the search', () => {
  render(<CallsPanel calls={[]} rateCents="1500" historyUrl="/api/provider/calls?q=OCR" status="paid" pagePath="/provider" query={{ q: 'OCR' }}/>);
  const link = screen.getByRole('link', { name: 'Not charged' }); const url = new URL(link.getAttribute('href')!, 'https://settl.example');
  expect(url.searchParams.get('status')).toBe('not_charged'); expect(url.searchParams.get('q')).toBe('OCR'); expect(url.searchParams.has('cursor')).toBe(false);
  expect(screen.getByRole('link', { name: 'Paid' }).getAttribute('aria-current')).toBe('page');
});
it('exports every matching history page and shows progress without automatic retries', async () => {
  const row = { id: 'call', agentId: 'owned', endpointId: 'ocr', agent: 'Agent', customer: 'Customer', provider: 'Provider', endpoint: '/ocr', status: 'paid', amountStroops: '1', quotedStroops: '1', time: '2026-11-06T00:00:00Z', confirmedAt: null, txHash: null, verification: null, checks: [] };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ calls: [row], nextCursor: 'next:25' }) }).mockResolvedValueOnce({ ok: false });
  vi.stubGlobal('fetch', request);
  render(<CallsPanel calls={[row]} rateCents="1500" historyUrl="/api/buyer/calls?q=OCR&status=paid" pagePath="/buyer"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); expect((screen.getByRole('button', { name: 'Exporting CSV…' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Export failed/)); expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toBe('/api/buyer/calls?q=OCR&status=paid'); expect(request.mock.calls[1][0]).toContain('cursor=next%3A25');
});
it('includes later pages in the downloaded CSV', async () => {
  const row = { id: 'first-call', agentId: 'owned', endpointId: 'ocr', agent: 'Agent', customer: 'Customer', provider: 'Provider', endpoint: '/ocr', status: 'paid', amountStroops: '1', quotedStroops: '1', time: '2026-11-06T00:00:00Z', confirmedAt: null, txHash: null, verification: null, checks: [] };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ calls: [row], nextCursor: 'next' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ calls: [{ ...row, id: 'later-call' }], nextCursor: null }) });
  vi.stubGlobal('fetch', request); let downloaded: Blob | undefined;
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL(blob: Blob) { downloaded = blob; return 'blob:export'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<CallsPanel calls={[row]} rateCents="1500" historyUrl="/api/provider/calls"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); await waitFor(() => expect(screen.getByRole('status').textContent).toBe('CSV ready: 2 calls.'));
  const csv = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(downloaded!); });
  expect(csv).toContain('first-call'); expect(csv).toContain('later-call'); expect(request).toHaveBeenCalledTimes(2);
});

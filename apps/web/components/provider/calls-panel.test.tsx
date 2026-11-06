import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CallsPanel } from './calls-panel';
afterEach(cleanup);
it('offers keyboard-focusable status filters and an honest empty state', () => {
  render(<CallsPanel rateCents="1500" calls={[]}/>);
  const filter = screen.getByRole('button', { name: 'Paid' }); filter.focus(); expect(document.activeElement).toBe(filter); expect(filter.tabIndex).toBe(0); expect(screen.getByText('No calls match this filter.')).toBeTruthy(); expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
});
it('filters live statuses and shows the actual failed verification without inventing a transaction', () => {
  render(<CallsPanel rateCents="1500" calls={[{ id: 'call', agentId: 'owned', endpointId: 'ocr', agent: 'Agent', customer: 'Customer', provider: 'Provider', endpoint: '/ocr', status: 'not_charged', amountStroops: '0', quotedStroops: '10000000', time: '2026-11-06T00:00:00Z', confirmedAt: null, txHash: null, verification: 'fail', checks: [{ check: 'confidence', ok: false, note: 'Too low' }] }]}/>);
  fireEvent.click(screen.getByRole('button', { name: 'View call' })); expect(screen.getByText('confidence: Failed, Too low')).toBeTruthy(); expect(screen.getByText('No transaction recorded.')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Paid' })); expect(screen.getByText('No calls match this filter.')).toBeTruthy();
});

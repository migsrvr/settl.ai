import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HistoryPagination } from './history-pagination';
afterEach(cleanup);
it('encodes the cursor and preserves the full search query', () => {
  render(<HistoryPagination path="/buyer" nextCursor="date:id/next?" query={{ q: 'receipt & OCR' }} label="Next 25 calls"/>);
  const link = screen.getByRole('link', { name: 'Next 25 calls' });
  const url = new URL(link.getAttribute('href')!, 'https://settl.example');
  expect(url.searchParams.get('cursor')).toBe('date:id/next?'); expect(url.searchParams.get('q')).toBe('receipt & OCR');
});
it('keeps independent topup and activity pagination positions', () => {
  render(<HistoryPagination path="/buyer/agents/owned" nextCursor="topup:26" cursorKey="topupCursor" query={{ cursor: 'call:26' }} label="Next 25 budget loads"/>);
  const href = screen.getByRole('link').getAttribute('href')!;
  expect(new URL(href, 'https://settl.example').searchParams.get('cursor')).toBe('call:26'); expect(new URL(href, 'https://settl.example').searchParams.get('topupCursor')).toBe('topup:26');
});
it('has no next-page action when the history ends', () => {
  render(<HistoryPagination path="/buyer" nextCursor={null}/>); expect(screen.queryByRole('link')).toBeNull();
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AddRouteForm, IntegrateSection } from './endpoint-tools';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('saves route settings through the provider API and waits for its result', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'unavailable' }) }); vi.stubGlobal('fetch', request);
  render(<AddRouteForm rateCents="1500"/>);
  fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'Translate' } }); fireEvent.change(screen.getByLabelText('Route path'), { target: { value: '/translate' } }); fireEvent.change(screen.getByLabelText('Provider URL'), { target: { value: 'https://provider.example/translate' } }); fireEvent.change(screen.getByLabelText('Price per call, PHP'), { target: { value: '2.00' } }); fireEvent.click(screen.getByRole('button', { name: 'Add route' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy()); expect(screen.queryByText(/Route saved/)).toBeNull(); expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ method: 'POST', priceStroops: '1333334', criteriaId: 'receipt_v1' });
});
it('generates integration code with the actual stored endpoint ID', () => { render(<IntegrateSection endpoints={[{ id: 'real-endpoint', route: '/ocr', method: 'POST', name: 'OCR', price: '1', mode: 'outcome', active: true }]}/>); expect(screen.getByText(/endpointId: "real-endpoint"/)).toBeTruthy(); expect(screen.queryByText('Next.js')).toBeNull(); });

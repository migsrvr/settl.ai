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

function fillRequired() {
  fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'Translate' } });
  fireEvent.change(screen.getByLabelText('Route path'), { target: { value: '/translate' } });
  fireEvent.change(screen.getByLabelText('Provider URL'), { target: { value: 'https://provider.example/translate' } });
  fireEvent.change(screen.getByLabelText('Price per call, PHP'), { target: { value: '2.00' } });
}

it('sends the description, input schema and example that agents will see', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ endpointId: 'ep' }) }); vi.stubGlobal('fetch', request);
  render(<AddRouteForm rateCents="1500"/>);
  fillRequired();
  fireEvent.change(screen.getByLabelText('What it does, for agents'), { target: { value: 'Translates text to Filipino.' } });
  fireEvent.change(screen.getByLabelText('Input schema, JSON'), { target: { value: '{"type":"object","properties":{"text":{"type":"string"}}}' } });
  fireEvent.change(screen.getByLabelText('Example input, JSON'), { target: { value: '{"text":"Good morning"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add route' }));
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
    description: 'Translates text to Filipino.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    example: { text: 'Good morning' },
  });
});

it('leaves optional metadata out when it is empty', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ endpointId: 'ep' }) }); vi.stubGlobal('fetch', request);
  render(<AddRouteForm rateCents="1500"/>);
  fillRequired();
  fireEvent.click(screen.getByRole('button', { name: 'Add route' }));
  await waitFor(() => expect(request).toHaveBeenCalled());
  const body = JSON.parse(request.mock.calls[0][1].body);
  expect(body).not.toHaveProperty('description');
  expect(body).not.toHaveProperty('inputSchema');
  expect(body).not.toHaveProperty('example');
});

it('stops before saving when the schema is not valid JSON and says how to fix it', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  render(<AddRouteForm rateCents="1500"/>);
  fillRequired();
  fireEvent.change(screen.getByLabelText('Input schema, JSON'), { target: { value: '{type: object}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add route' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Input schema is not valid JSON/);
  expect(request).not.toHaveBeenCalled();
});

it('explains a schema the server rejects in plain words', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_input_schema' }) }); vi.stubGlobal('fetch', request);
  render(<AddRouteForm rateCents="1500"/>);
  fillRequired();
  fireEvent.change(screen.getByLabelText('Input schema, JSON'), { target: { value: '{"type":"array"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add route' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/object/i);
});

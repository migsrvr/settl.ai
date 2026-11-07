// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it.each([
  ['provider/page.tsx', 'loadProviderHome'], ['provider/endpoints/page.tsx', 'loadProviderEndpoints'],
  ['provider/earnings/page.tsx', 'loadProviderEarnings'], ['buyer/page.tsx', 'loadBuyerHome'],
  ['buyer/agents/new/page.tsx', 'loadNewAgentForm'], ['buyer/agents/[id]/page.tsx', 'loadBuyerAgentDetail'],
])('%s uses its focused loader', (path, loader) => {
  const source = readFileSync(resolve('app', path), 'utf8'); expect(source).toContain(loader); expect(source).not.toMatch(/load(?:Provider|Buyer)Dashboard/);
});
it('uses full-dataset pending claim state and targeted balance refresh', () => {
  const source = readFileSync(resolve('components/provider/claim-panel.tsx'), 'utf8'); expect(source).toContain('hasPendingClaim'); expect(source).toContain('live.refresh');
});

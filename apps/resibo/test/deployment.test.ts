// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import request from 'supertest';
import { expect, it } from 'vitest';
import { buildProvider } from '../scripts/build';

it('boots the packaged provider without depending on TypeScript workspace exports', async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const outDir = await mkdtemp(join(root, '.provider-build-test-'));
  try {
    const { file, metafile } = await buildProvider(outDir);
    const externalImports = Object.values(metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path));
    expect(externalImports.some(path => path.startsWith('@settl/'))).toBe(false);
    const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(file).href);
    const response = await request(handler).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'settl-demo-provider' });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

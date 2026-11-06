// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readConfig = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

describe('deployment packaging and runtime', () => {
  it('includes the shared source packages in the web server trace', () => {
    expect(nextConfig.outputFileTracingRoot).toBeTruthy();
    const traceRoot = nextConfig.outputFileTracingRoot!;
    for (const name of ['core', 'sdk', 'stellar', 'verifier']) {
      const packagePath = resolve(root, 'packages', name);
      const tracedPath = relative(traceRoot, packagePath);
      expect(tracedPath.startsWith('..')).toBe(false);
      expect(readConfig(`packages/${name}/package.json`).name).toBe(`@settl/${name}`);
    }
  });

  it('leaves time for the paid MCP call and its nested provider verification', () => {
    const web = readConfig('apps/web/vercel.json');
    const provider = readConfig('apps/resibo/vercel.json');
    expect(web.functions['app/mcp/route.ts'].maxDuration).toBeGreaterThan(125);
    expect(web.functions['app/api/**/*.ts'].maxDuration).toBeGreaterThan(125);
    expect(provider.functions['api/index.mjs'].maxDuration).toBeGreaterThan(120);
    expect(typeof provider.functions['api/index.mjs'].includeFiles).toBe('string');
    expect(readFileSync(resolve(root, 'apps/resibo/public/robots.txt'), 'utf8')).toContain('User-agent:');
  });
});

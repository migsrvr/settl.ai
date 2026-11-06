import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildProvider(outDir = resolve(root, 'dist')) {
  const file = resolve(outDir, 'server.mjs');
  const { metafile } = await build({
    entryPoints: [resolve(root, 'src/server.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['express'],
    metafile: true,
  });
  return { file, metafile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildProvider();
}

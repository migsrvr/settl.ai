// Swap a workspace package's source-pointing manifest for its publishable one around `npm pack`/`npm publish`.
// Workspace packages export TypeScript source so tests and builds need no compile step. Published
// tarballs must point at the built `dist`. Each package keeps those overrides under `publishManifest`.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BACKUP = "package.json.settl-backup";

export function mergePublishManifest(pkg) {
  if (!pkg.publishManifest || typeof pkg.publishManifest !== "object") {
    throw new Error("package.json has no publishManifest block");
  }
  const { publishManifest, ...rest } = pkg;
  return { ...rest, ...publishManifest };
}

export function applyPublishManifest(dir) {
  const file = join(dir, "package.json");
  const backup = join(dir, BACKUP);
  if (existsSync(backup)) throw new Error("publish manifest already applied; run restore first");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const merged = mergePublishManifest(pkg);
  copyFileSync(file, backup);
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
}

export function restorePublishManifest(dir) {
  const backup = join(dir, BACKUP);
  if (!existsSync(backup)) return;
  renameSync(backup, join(dir, "package.json"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command] = process.argv.slice(2);
  if (command === "apply") applyPublishManifest(process.cwd());
  else if (command === "restore") restorePublishManifest(process.cwd());
  else {
    console.error("usage: publish-manifest.mjs apply|restore");
    process.exit(2);
  }
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPublishManifest, mergePublishManifest, restorePublishManifest } from "./publish-manifest.mjs";

const source = {
  name: "@settl/example",
  version: "0.1.0",
  private: true,
  type: "module",
  main: "./src/index.ts",
  types: "./src/index.ts",
  exports: { ".": "./src/index.ts" },
  publishManifest: {
    private: false,
    main: "./dist/index.cjs",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", require: "./dist/index.cjs" } },
  },
};

function project() {
  const dir = mkdtempSync(join(tmpdir(), "settl-publish-"));
  const text = `${JSON.stringify(source, null, 2)}\n`;
  writeFileSync(join(dir, "package.json"), text);
  return { dir, text };
}

test("merge replaces entry fields, keeps the rest and drops the override block", () => {
  const merged = mergePublishManifest(source);
  assert.equal(merged.private, false);
  assert.equal(merged.main, "./dist/index.cjs");
  assert.deepEqual(Object.keys(merged.exports["."]), ["types", "import", "require"]);
  assert.equal(merged.name, "@settl/example");
  assert.equal(merged.type, "module");
  assert.equal("publishManifest" in merged, false);
  assert.equal(source.main, "./src/index.ts", "input is not mutated");
});

test("merge refuses a package without publish overrides", () => {
  assert.throws(() => mergePublishManifest({ name: "x" }), /publishManifest/);
});

test("apply then restore returns the original file byte for byte", () => {
  const { dir, text } = project();
  try {
    applyPublishManifest(dir);
    const applied = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    assert.equal(applied.main, "./dist/index.cjs");
    assert.ok(existsSync(join(dir, "package.json.settl-backup")));
    restorePublishManifest(dir);
    assert.equal(readFileSync(join(dir, "package.json"), "utf8"), text);
    assert.equal(existsSync(join(dir, "package.json.settl-backup")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply refuses to run twice so the backup is never overwritten", () => {
  const { dir } = project();
  try {
    applyPublishManifest(dir);
    assert.throws(() => applyPublishManifest(dir), /already applied/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restore without a backup is a harmless no-op", () => {
  const { dir, text } = project();
  try {
    restorePublishManifest(dir);
    assert.equal(readFileSync(join(dir, "package.json"), "utf8"), text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

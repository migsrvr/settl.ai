// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ endpoint: { findMany: vi.fn() } }));
vi.mock("./db", () => ({ getDb: () => db }));

import { invalidateCatalog, loadCatalog, toolNames } from "./service-catalog";

const row = (id: string, name: string, providerId: string) => ({
  id, name, providerId, price: 1_333_334n, mode: "per_call", description: null, inputSchema: null, example: null,
  provider: { displayName: providerId },
});

beforeEach(() => {
  vi.resetAllMocks();
  invalidateCatalog();
});

describe("service catalog cache", () => {
  it("reads active services once and reuses them for 30 seconds", async () => {
    db.endpoint.findMany.mockResolvedValue([row("ocr", "Receipt OCR", "resibo")]);
    let now = 1_000_000;
    const clock = () => now;
    expect((await loadCatalog(clock)).map((entry) => entry.id)).toEqual(["ocr"]);
    now += 29_000;
    await loadCatalog(clock);
    expect(db.endpoint.findMany).toHaveBeenCalledTimes(1);
    expect(db.endpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
    now += 2_000;
    await loadCatalog(clock);
    expect(db.endpoint.findMany).toHaveBeenCalledTimes(2);
  });

  it("reloads right away after a registration invalidates it", async () => {
    db.endpoint.findMany.mockResolvedValue([]);
    await loadCatalog();
    invalidateCatalog();
    await loadCatalog();
    expect(db.endpoint.findMany).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed read", async () => {
    db.endpoint.findMany.mockRejectedValueOnce(new Error("db down")).mockResolvedValue([]);
    await expect(loadCatalog()).rejects.toThrow();
    await expect(loadCatalog()).resolves.toEqual([]);
  });
});

describe("toolNames", () => {
  const names = (rows: Array<ReturnType<typeof row>>) => toolNames(rows.map((r) => ({ ...r, providerName: r.provider.displayName })));

  it("names tools after the provider and the service, without repeating the provider", () => {
    expect([...names([
      row("resibo_parse", "Receipt OCR", "resibo"),
      row("geoph_lookup", "GeoPH lookup", "geoph"),
    ]).values()]).toEqual(["resibo_receipt_ocr", "geoph_lookup"]);
  });

  it("keeps names unique, valid and clear of the settl_ tools", () => {
    const result = names([
      row("cm1abcdef", "Receipt OCR", "acme"),
      row("cm2ghijkl", "Receipt  OCR!", "acme"),
      row("x", "Get budget", "settl"),
      row("y", "Ünïcödé ✨ name", "p"),
      row("z", "a".repeat(200), "provider"),
    ]);
    const values = [...result.values()];
    expect(new Set(values).size).toBe(values.length);
    for (const name of values) {
      expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(name.startsWith("settl_")).toBe(false);
    }
    expect(result.get("cm1abcdef")).toBe("acme_receipt_ocr");
    expect(result.get("cm2ghijkl")).toMatch(/^acme_receipt_ocr_/);
  });
});

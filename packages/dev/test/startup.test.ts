import net from "node:net";
import { describe, expect, it } from "vitest";
import { startSandbox } from "../src/index";

function occupyPort(): Promise<{ port: number; release(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", () => resolve({
      port: (blocker.address() as net.AddressInfo).port,
      release: () => new Promise((done) => blocker.close(() => done())),
    }));
  });
}

describe("sandbox startup", () => {
  it("reports a taken port and releases everything so a later start works", async () => {
    const blocker = await occupyPort();
    try {
      await expect(startSandbox({ port: blocker.port })).rejects.toThrow(/EADDRINUSE/);
      const sandbox = await startSandbox({ port: 0 });
      expect((await fetch(`${sandbox.url}/health`)).status).toBe(200);
      await sandbox.close();
    } finally {
      await blocker.release();
    }
  }, 90_000);

  it("refuses a second sandbox in the same process instead of corrupting the first", async () => {
    const first = await startSandbox({ port: 0 });
    try {
      await expect(startSandbox({ port: 0 })).rejects.toThrow(/already running/);
      expect((await fetch(`${first.url}/health`)).status).toBe(200);
    } finally {
      await first.close();
    }
  }, 90_000);
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTimingTracker } from "./timing";

describe("sanitized timing and correlation instrumentation", () => {
  it("generates or reuses a safe correlation ID and measures phases separately", async () => {
    let clock = 1000;
    const sink = vi.fn();
    const timer = createTimingTracker("broker.executeCall", {
      correlationId: "req-safe-123",
      nowMs: () => clock,
      sink,
    });

    expect(timer.correlationId).toBe("req-safe-123");

    const authOut = await timer.measure("auth", async () => {
      clock += 12;
      return "agent-1";
    });
    expect(authOut).toBe("agent-1");

    await timer.measure("db", async () => {
      clock += 28;
    });
    await timer.measure("settlement", async () => {
      clock += 4100;
    });
    await timer.measure("provider_call", async () => {
      clock += 85;
    });
    await timer.measure("post_payment", async () => {
      clock += 4;
    });

    const summary = timer.finish("paid");
    expect(summary).toEqual({
      correlationId: "req-safe-123",
      operation: "broker.executeCall",
      status: "paid",
      totalMs: 4229,
      phases: {
        auth: 12,
        db: 28,
        settlement: 4100,
        provider_call: 85,
        post_payment: 4,
      },
    });
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith(summary);
  });

  it("rejects unsafe correlation IDs and never logs credentials, signatures, or raw payloads", async () => {
    const sink = vi.fn();
    const timer = createTimingTracker("api.call", {
      correlationId: "Bearer stl_agent_secret_token_123456",
      sink,
    });
    expect(timer.correlationId).not.toContain("stl_agent");
    expect(timer.correlationId).toMatch(/^[a-f0-9-]{8,64}$/i);

    const summary = timer.finish("unauthorized", {
      authorization: "Bearer stl_agent_secret",
      walletSecretEnc: "v1:secret",
      signature: "v1=deadbeef",
      rawBody: "{\"amount\":1000}",
      endpointId: "resibo_parse",
      httpStatus: 401,
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("stl_agent_secret");
    expect(serialized).not.toContain("v1:secret");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("amount");
    expect(summary.meta).toEqual({
      endpointId: "resibo_parse",
      httpStatus: 401,
    });
  });
});


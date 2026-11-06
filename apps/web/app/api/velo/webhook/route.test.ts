// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { handleVeloWebhook } = vi.hoisted(() => ({ handleVeloWebhook: vi.fn() }));
vi.mock("@/lib/server/velo", () => ({ handleVeloWebhook }));
beforeEach(() => { vi.resetAllMocks(); handleVeloWebhook.mockResolvedValue({ received: true }); });
describe("public Velo webhook route", () => {
  it("forwards exact raw bytes and signed headers without buyer authentication", async () => {
    const raw = '{ "spacing": true }\n';
    const response = await POST(new Request("https://settl.test/api/velo/webhook", { method: "POST", headers: { "x-velo-signature": "signature", "x-velo-delivery": "delivery" }, body: raw }));
    expect(response.status).toBe(200); expect(handleVeloWebhook).toHaveBeenCalledWith({ payload: raw, signature: "signature", deliveryId: "delivery" });
    expect(await response.json()).toEqual({ received: true });
  });
  it("returns safe verification errors without echoing payloads or credentials", async () => {
    handleVeloWebhook.mockRejectedValueOnce({ status: 400, code: "invalid_velo_signature", message: "secret" });
    const response = await POST(new Request("https://settl.test/api/velo/webhook", { method: "POST", body: "private" }));
    expect(response.status).toBe(400); expect(await response.text()).not.toMatch(/private|secret/);
  });
});

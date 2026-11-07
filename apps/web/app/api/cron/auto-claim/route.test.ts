// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const { claims, intents, deliveries, topups, provisioning } = vi.hoisted(() => ({ claims: vi.fn(), intents: vi.fn(), deliveries: vi.fn(), topups: vi.fn(), provisioning: vi.fn() }));
vi.mock('@/lib/server/agent-provisioning', () => ({ processAgentProvisioning: provisioning }));
vi.mock("@/lib/server/velo", () => ({ processPaidTopups: topups }));
vi.mock("@/lib/server/claims", () => ({ autoClaimProviders: claims }));
vi.mock("@/lib/server/dispatcher", () => ({ flushAutomationEvents: intents, flushDueDeliveries: deliveries }));
const request = (token = "cron-secret") => new Request("https://settl.test/api/cron/auto-claim", { method: "POST", headers: { authorization: `Bearer ${token}` } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "cron-secret"); provisioning.mockResolvedValue({ processed: 1, active: 1, pending: 0, failed: 0, errors: 0 }); claims.mockResolvedValue({ completed: 1 }); intents.mockResolvedValue({ processed: 2, errors: 0 }); deliveries.mockResolvedValue({ delivered: 2 }); topups.mockResolvedValue({ processed: 1, completed: 1, failed: 0, pending: 0, blocked: false }); });
afterEach(() => vi.unstubAllEnvs());
describe("protected automation cron", () => {
  it('processes persisted provisioning jobs only after cron authentication', async () => {
    expect((await POST(request('bad'))).status).toBe(401); expect(provisioning).not.toHaveBeenCalled();
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(provisioning).toHaveBeenCalledOnce(); expect(await response.json()).toMatchObject({ provisioning: { processed: 1, active: 1 } });
  });
  it('reports failed provisioning without suppressing other durable queues or leaking errors', async () => {
    provisioning.mockRejectedValue(new Error('custodial-wallet-secret'));
    const response = await POST(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('custodial');
    expect(topups).toHaveBeenCalledOnce(); expect(claims).toHaveBeenCalledOnce();
  });
  it("supports scheduler GET with identical authentication and uncached processing", async () => {
    const get = (token?: string) => new Request("https://settl.test/api/cron/auto-claim", { headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get("bad"))).status).toBe(401);
    expect(intents).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", ""); expect((await GET(get("cron-secret"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const response = await GET(get("cron-secret"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(intents).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce(); expect(claims).toHaveBeenCalledOnce(); expect(topups).toHaveBeenCalledOnce();
  });
  it("fails closed when unconfigured and rejects bad bearer credentials", async () => {
    vi.stubEnv("CRON_SECRET", ""); expect((await POST(request())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret"); expect((await POST(request("bad"))).status).toBe(401);
    expect((await POST(new Request("https://settl.test/api/cron/auto-claim", { method: "POST" }))).status).toBe(401);
    expect(claims).not.toHaveBeenCalled(); expect(intents).not.toHaveBeenCalled(); expect(deliveries).not.toHaveBeenCalled(); expect(topups).not.toHaveBeenCalled();
  });
  it("drains automation intents, due retries and enabled auto-claims", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ automations: { processed: 2 }, deliveries: { delivered: 2 }, claims: { completed: 1 }, topups: { completed: 1 } });
    expect(topups).toHaveBeenCalledOnce();
    expect(intents).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce(); expect(claims).toHaveBeenCalledOnce();
  });
  it("hides unexpected errors and still attempts independent automation work", async () => {
    intents.mockRejectedValueOnce(new Error("password=secret"));
    const response = await POST(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("password");
    expect(claims).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce();
  });
  it.each(["automations", "claims"])("reports partial %s processing as failure while attempting the other queues", async (failedQueue) => {
    if (failedQueue === "automations") intents.mockResolvedValueOnce({ processed: 0, errors: 1 });
    else claims.mockResolvedValueOnce({ completed: 0, failed: 1 });
    expect((await POST(request())).status).toBe(500);
    expect(intents).toHaveBeenCalledOnce(); expect(claims).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce();
  });
  it("reports unresolved funding without retrying it or suppressing other queues", async () => {
    topups.mockResolvedValueOnce({ processed: 0, completed: 0, failed: 0, pending: 0, blocked: true });
    expect((await POST(request())).status).toBe(500);
    expect(topups).toHaveBeenCalledOnce(); expect(claims).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce();
  });
  it("still drains independent queues when top-up processing throws", async () => {
    topups.mockRejectedValueOnce(new Error("secret treasury key"));
    const response = await POST(request()); expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("treasury"); expect(claims).toHaveBeenCalledOnce(); expect(deliveries).toHaveBeenCalledOnce();
  });
});

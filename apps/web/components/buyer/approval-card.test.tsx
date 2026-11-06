import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./approval-card";

const pending = { id: "approval-1", quoteId: "quote-1", status: "pending", amountPhp: "12.50", providerName: "Live Maps", agentName: "Stored Bookkeeper", expiresAt: "2050-11-06T00:05:00Z", payment: null, capPhp: "15.00", autoApprovePhp: "5.00" };
const fetcher = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation(async () => json(pending)); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("live buyer approval card", () => {
  it("loads the owned approval and renders its actual amount and parties", async () => {
    render(<ApprovalCard approvalId="approval-1" />);
    expect(await screen.findByRole("heading", { name: "Pay Live Maps ₱12.50?" })).toBeTruthy();
    expect(screen.getByText(/Stored Bookkeeper wants/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve ₱12.50 once" })).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith("/api/approvals/approval-1", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    expect(screen.queryByText(/b8e1/)).toBeNull();
  });
  it("submits once with cookies, disables both actions, and stays approved until a real paid snapshot arrives", async () => {
    let finish: (response: Response) => void = () => {};
    fetcher.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : json(pending));
    render(<ApprovalCard approvalId="approval-1" />); fireEvent.click(await screen.findByRole("button", { name: "Approve ₱12.50 once" }));
    expect((screen.getByRole("button", { name: /Approving/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/approvals/approval-1/resolve", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ decision: "approved" }) }));
    await act(async () => finish(json({ id: "approval-1", status: "approved" })));
    expect(await screen.findByText("Approved. Waiting for the agent to continue.")).toBeTruthy();
    vi.useFakeTimers(); fetcher.mockImplementation(async () => json({ ...pending, status: "approved", payment: { status: "pending" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByText("Paid")).toBeNull(); expect(screen.queryByRole("link", { name: /Transaction/ })).toBeNull();
  });
  it("shows paid only for a paid snapshot and links the real transaction", async () => {
    const hash = "ab".repeat(32); fetcher.mockResolvedValueOnce(json({ ...pending, status: "approved", payment: { status: "paid", txHash: hash } }));
    render(<ApprovalCard approvalId="approval-1" />);
    expect(await screen.findByText("Live Maps got ₱12.50")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Transaction/ }).getAttribute("href")).toBe(`https://stellar.expert/explorer/testnet/tx/${hash}`);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
  it("polls until an approved request has an observed paid payment", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(async () => json({ ...pending, status: "approved", payment: { status: "pending" } }));
    render(<ApprovalCard approvalId="approval-1" />);
    await act(async () => {});
    expect(screen.getByText("Approved. Waiting for the agent to continue.")).toBeTruthy();
    fetcher.mockImplementation(async () => json({ ...pending, status: "approved", payment: { status: "paid", txHash: "cd".repeat(32) } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText("Live Maps got ₱12.50")).toBeTruthy();
  });
  it("submits a decline and keeps the terminal decision visible", async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === "POST" ? json({ id: "approval-1", status: "declined" }) : json(pending));
    render(<ApprovalCard approvalId="approval-1" />); fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined. This approval cannot be used.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
  it("shows expiry without spending controls", async () => {
    fetcher.mockResolvedValueOnce(json({ ...pending, status: "expired" })); render(<ApprovalCard approvalId="approval-1" />);
    expect(await screen.findByText("This approval expired. Ask the agent for a new request.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
  it("refreshes after a conflict instead of repeating the decision", async () => {
    let resolved = false;
    fetcher.mockImplementation(async (_url, init) => { if (init?.method === "POST") { resolved = true; return json({ error: "approval_expired" }, 409); } return json({ ...pending, status: resolved ? "expired" : "pending" }); });
    render(<ApprovalCard approvalId="approval-1" />); fireEvent.click(await screen.findByRole("button", { name: "Approve ₱12.50 once" }));
    expect(await screen.findByText("This approval expired. Ask the agent for a new request.")).toBeTruthy();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("shows safe errors and supports an explicit refresh", async () => {
    fetcher.mockRejectedValueOnce(new Error("private details")); render(<ApprovalCard approvalId="approval-1" />);
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.queryByText(/private details/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh approval" }));
    expect(await screen.findByRole("heading", { name: "Pay Live Maps ₱12.50?" })).toBeTruthy();
  });
  it("shows a missing approval ID as unavailable and does not call a fake demo ID", async () => {
    render(<ApprovalCard />); await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
});

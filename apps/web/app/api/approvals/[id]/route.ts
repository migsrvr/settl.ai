import { ApiError, apiErrorResponse, jsonResponse, requireBuyerOrg } from "@/lib/server/api-auth";
import { getDb } from "@/lib/server/db";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    const { id } = await context.params;
    const approval = await getDb().approval.findFirst({
      where: { id, agent: { orgId } },
      select: {
        id: true, status: true, amount: true, quoteId: true, expiresAt: true,
        agent: { select: { name: true, policy: { select: { maxAmount: true, autoApproveUpTo: true } } } },
        provider: { select: { displayName: true } }, quote: { select: { payment: { select: { status: true, txHash: true } } } },
      },
    });
    if (!approval) throw new ApiError(404, "approval_not_found");
    const rate = Number(process.env.PHP_PER_XLM ?? "15");
    if (!Number.isFinite(rate) || rate < .01 || !Number.isSafeInteger(Math.round(rate * 100)) || Number(rate.toFixed(2)) !== rate) throw new ApiError(503, "invalid_exchange_rate");
    const rateCents = BigInt(Math.round(rate * 100));
    const php = (amount: bigint) => {
      const cents = (amount * rateCents + 5_000_000n) / 10_000_000n;
      return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
    };
    return jsonResponse({
      id: approval.id, quoteId: approval.quoteId,
      status: approval.status === "pending" && approval.expiresAt <= new Date() ? "expired" : approval.status,
      amountPhp: php(approval.amount), providerName: approval.provider.displayName, agentName: approval.agent.name,
      expiresAt: approval.expiresAt.toISOString(),
      payment: approval.quote.payment ? { status: approval.quote.payment.status, ...(approval.quote.payment.txHash ? { txHash: approval.quote.payment.txHash } : {}) } : null,
      ...(approval.agent.policy ? { capPhp: php(approval.agent.policy.maxAmount), autoApprovePhp: php(approval.agent.policy.autoApproveUpTo) } : {}),
    });
  } catch (error) { return apiErrorResponse(error); }
}

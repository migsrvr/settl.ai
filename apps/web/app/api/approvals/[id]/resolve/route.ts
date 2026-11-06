import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { getDb } from "@/lib/server/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    if (body.decision !== "approved" && body.decision !== "declined") throw new ApiError(400, "invalid_decision");
    const decision = body.decision;
    const { id } = await context.params;
    if (!id?.trim()) throw new ApiError(404, "approval_not_found");
    const db = getDb();
    const resolution = await db.$transaction(async (tx) => {
      const found = await tx.approval.findUnique({ where: { id }, include: { agent: true } });
      if (!found || found.agent.orgId !== orgId) throw new ApiError(404, "approval_not_found");
      // Serialize with broker approval consumption and other buyer decisions.
      await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${found.agentId} FOR UPDATE`;
      const approval = await tx.approval.findUnique({ where: { id }, include: { agent: true, provider: true } });
      if (!approval || approval.agent.orgId !== orgId) throw new ApiError(404, "approval_not_found");
      const at = new Date();
      if (approval.status !== "pending") throw new ApiError(409, "approval_already_resolved");
      if (approval.expiresAt <= at) throw new ApiError(409, "approval_expired");
      const updated = await tx.approval.updateMany({ where: { id, agentId: approval.agentId, status: "pending", expiresAt: { gt: at } }, data: { status: decision, resolvedAt: at } });
      if (!updated.count) throw new ApiError(409, "approval_already_resolved");
      const eventId = `approval:${id}:resolved`;
      await tx.webhookEvent.upsert({ where: { source_eventId: { source: "settl", eventId } }, update: {}, create: {
        source: "settl", eventId, verified: true,
        payload: { eventId, event: "approval.resolved", agentId: approval.agentId, providerId: approval.providerId,
          orgIds: [...new Set([orgId, approval.provider.orgId])],
          payload: { approvalId: id, quoteId: approval.quoteId, agentId: approval.agentId, providerId: approval.providerId, amountStroops: approval.amount.toString(), status: decision, resolvedAt: at.toISOString() },
        },
      } });
      return { id, status: decision, resolvedAt: at.toISOString(), eventId };
    });
    return jsonResponse({ id: resolution.id, status: resolution.status, resolvedAt: resolution.resolvedAt });
  } catch (error) { return apiErrorResponse(error); }
}

import { tool, type Tool } from "ai";
import * as z from "zod";
import type { SettlClient } from "./index";

const serviceId = z.string().trim().min(1).max(256).describe("A service id from settl_list_services.");
const approvalId = z.string().trim().min(1).max(256);
const pesos = z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, 'Use pesos with at most two decimals, for example "10.00".');

export type SettlToolName =
  | "settl_list_services" | "settl_get_budget" | "settl_quote" | "settl_call" | "settl_check_approval" | "settl_wait_for_approval"
  | "settl_receipts";

/**
 * Vercel AI SDK tools backed by a connected Settl client. Give them to `generateText` or an agent;
 * the model decides when to look up prices, check its budget and buy.
 */
// The explicit return type keeps the published .d.ts free of the AI SDK's internal dependency types.
export function settlTools(client: SettlClient): Record<SettlToolName, Tool> {
  return {
    settl_list_services: tool({
      description: "List the paid services you can buy, with their prices in pesos and, when given, what each does, "
        + "the JSON Schema its input must match and an example. Free to call. Do this before buying.",
      inputSchema: z.object({}),
      execute: () => client.listServices(),
    }),
    settl_get_budget: tool({
      description: "Read your balance, daily spending so far, spending limits and any approvals waiting for a human. Free to call.",
      inputSchema: z.object({}),
      execute: () => client.getBudget(),
    }),
    settl_quote: tool({
      description: "Get the exact price of one service without paying for it.",
      inputSchema: z.object({ serviceId }),
      execute: ({ serviceId }) => client.quote(serviceId),
    }),
    settl_call: tool({
      description: "Buy and run a paid service. This spends money. Set maxPricePhp to the most you accept. "
        + "Send input that matches the service's inputSchema; mismatched input is refused without charge. "
        + "If the result is approval_required, a human must approve: call settl_wait_for_approval, then call again with that approvalId. "
        + "Never repeat a call whose status is pending; check settl_receipts first.",
      inputSchema: z.object({ serviceId, input: z.json().optional(), maxPricePhp: pesos.optional(), approvalId: approvalId.optional() }),
      execute: ({ serviceId, input, maxPricePhp, approvalId }) => client.call(serviceId, {
        ...(input === undefined ? {} : { input }),
        ...(maxPricePhp === undefined ? {} : { maxPricePhp }),
        ...(approvalId === undefined ? {} : { approvalId }),
      }),
    }),
    settl_check_approval: tool({
      description: "Read whether a human has approved a purchase. This does not pay; call settl_call with the approvalId once it says approved.",
      inputSchema: z.object({ approvalId }),
      execute: ({ approvalId }) => client.checkApproval(approvalId),
    }),
    settl_wait_for_approval: tool({
      description: "Wait (up to 55 seconds) for a human to approve or decline a purchase and return the decision. This does not pay; "
        + "when it says approved, call settl_call again with the approvalId.",
      inputSchema: z.object({ approvalId, timeoutSeconds: z.number().int().min(1).max(55).default(25) }),
      execute: ({ approvalId, timeoutSeconds }) => client.waitForApproval(approvalId, { timeoutSeconds }),
    }),
    settl_receipts: tool({
      description: "List your recent payment receipts, including calls that were not charged or were blocked.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
      execute: ({ limit }) => client.receipts(limit),
    }),
  };
}

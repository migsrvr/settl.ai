import * as z from "zod";

const STROOPS = z.string().regex(/^\d+$/, "Amount must be whole stroops");

export const CriteriaSchema = z.object({
  schema: z.string(),
  required: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  lineItemsSumToTotal: z.object({ tolerance: z.number().nonnegative() }).optional(),
});

export const QuoteSchema = z
  .object({
    settl: z.literal("0.1"),
    quoteId: z.string().min(1),
    mode: z.enum(["per-call", "outcome"]),
    network: z.literal("stellar:testnet"),
    asset: z.string().min(1),
    amountStroops: STROOPS,
    displayPrice: z.object({ currency: z.literal("PHP"), amount: z.string() }),
    merchant: z.string().min(1),
    escrowContract: z.string().min(1),
    expiresAt: z.string(),
    resource: z.string(),
    description: z.string(),
    criteria: CriteriaSchema.optional(),
  })
  .refine((q) => q.mode !== "outcome" || q.criteria, { message: "Outcome quotes need criteria", path: ["criteria"] });

export const PaymentHeaderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tx"), quoteId: z.string().min(1), txHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ kind: z.literal("commit"), quoteId: z.string().min(1), reservationId: z.string().min(1) }),
]);

export const CheckResultSchema = z.object({ check: z.string(), ok: z.boolean(), note: z.string() });

export const ReceiptSchema = z.object({
  quoteId: z.string(),
  status: z.enum(["paid", "not_charged", "blocked"]),
  amountStroops: STROOPS,
  txHash: z.string().optional(),
  checks: z.array(CheckResultSchema).optional(),
});

export type Criteria = z.infer<typeof CriteriaSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type PaymentHeader = z.infer<typeof PaymentHeaderSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

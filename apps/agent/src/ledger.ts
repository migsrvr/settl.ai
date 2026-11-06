import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const money = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100);
const itemSchema = z.object({ description: z.string().trim().min(1), amount: money });
const receiptSchema = z.object({
  quoteId: z.string().min(1), status: z.literal('paid'), amountStroops: z.string().regex(/^[1-9]\d*$/),
  txHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  checks: z.array(z.object({ check: z.string(), ok: z.boolean(), note: z.string().optional() })),
});
const outputSchema = z.object({
  merchant_name: z.string().trim().min(1), date: z.iso.date(), total: money,
  line_items: z.array(itemSchema).min(1), confidence: z.number().min(0.85).max(1),
}).refine((data) => {
  const amounts = [data.total, ...data.line_items.map((item) => item.amount)];
  if (amounts.some((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)) return false;
  return Math.round(data.total * 100) === data.line_items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
}, 'Receipt amounts must sum exactly in PHP cents');
const expenseSchema = z.object({
  quoteId: z.string().min(1), txHash: z.string().regex(/^[a-fA-F0-9]{64}$/), feeStroops: z.string().regex(/^[1-9]\d*$/),
  merchant: z.string().min(1), date: z.iso.date(), totalPhp: money, lineItems: z.array(itemSchema).min(1), recordedAt: z.iso.datetime(),
});
export type Expense = z.infer<typeof expenseSchema>;
const operationSchema = z.object({
  status: z.enum(['submitted', 'unknown', 'pending', 'paid', 'not_charged', 'declined', 'blocked', 'approval_required']),
  reason: z.string().optional(), approvalId: z.string().optional(),
  approvalStatus: z.enum(['pending', 'approved', 'declined', 'expired', 'timed_out']).optional(),
  quoteId: z.string().optional(), txHash: z.string().optional(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resumeAttempted: z.boolean().optional(),
});
export type Operation = z.infer<typeof operationSchema>;
const stateSchema = z.object({ version: z.literal(1), expenses: z.array(expenseSchema), operations: z.record(z.string(), operationSchema) });
type State = z.infer<typeof stateSchema>;

/** One writer per file. The CLI acquires an exclusive lock for its whole run. */
export class Ledger {
  private state: State = { version: 1, expenses: [], operations: {} };
  constructor(readonly path: string) {}
  get expenses(): readonly Expense[] { return this.state.expenses; }
  operation(key: string): Operation | undefined { return this.state.operations[key]; }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const path = `${this.path}.lock`;
    const handle = await open(path, 'wx', 0o600).catch(() => { throw new Error('Ledger is locked. Reconcile any interrupted call before removing a stale lock.'); });
    return async () => { await handle.close(); await unlink(path); };
  }
  async load(): Promise<void> {
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Ledger is invalid or unreadable; refusing to overwrite it.'); }
  }
  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(this.state, null, 2)}\n`); await handle.sync(); await handle.close();
      await rename(temporary, this.path);
    } catch (error) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  }
  async saveOperation(key: string, operation: Operation): Promise<void> {
    this.state.operations[key] = operationSchema.parse(operation); await this.save();
  }
  async recordExpense(result: unknown): Promise<boolean> {
    const parsed = z.object({ status: z.literal('paid'), receipt: receiptSchema, data: outputSchema }).safeParse(result);
    if (!parsed.success || parsed.data.receipt.checks.some((check) => !check.ok)) return false;
    const { receipt, data } = parsed.data;
    if (this.state.expenses.some((item) => item.quoteId === receipt.quoteId || item.txHash.toLowerCase() === receipt.txHash.toLowerCase())) return false;
    this.state.expenses.push({ quoteId: receipt.quoteId, txHash: receipt.txHash, feeStroops: receipt.amountStroops,
      merchant: data.merchant_name, date: data.date, totalPhp: data.total, lineItems: data.line_items, recordedAt: new Date().toISOString() });
    await this.save(); return true;
  }
}

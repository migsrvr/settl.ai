// payment_escrow rejects any nonce <= the last one for a (device, agent) pair; gaps are fine.
// Callers hold the agent's row lock while allocating, so one payment is in flight per agent.
export function nextNonce(last: bigint): bigint {
  return last + 1n;
}

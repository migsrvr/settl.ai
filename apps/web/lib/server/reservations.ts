// Off-chain hold for Settl on Result: money is committed to a quote but not paid
// until the verifier passes the provider's result.

export type Reservation = {
  id: string;
  status: "held" | "settled" | "released";
  amount: bigint;
  expiresAt: Date;
  txHash?: string;
  releaseReason?: string;
};

export type ReservationAction = { type: "settle"; txHash: string } | { type: "release"; reason: string };

export function reservationReducer(r: Reservation, action: ReservationAction, now: Date): Reservation {
  if (r.status !== "held") throw new Error(`Reservation ${r.id} is already ${r.status}`);
  if (action.type === "settle") {
    if (now > r.expiresAt) throw new Error(`Reservation ${r.id} expired`);
    return { ...r, status: "settled", txHash: action.txHash };
  }
  return { ...r, status: "released", releaseReason: action.reason };
}

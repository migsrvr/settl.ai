export type ClaimState = {
  phase: "idle" | "confirm" | "settling" | "done";
  pending: number;
  claimed: number;
  sinceCalls: number;
};

export type ClaimAction = { type: "open" | "cancel" | "confirm" | "settled" | "reset" };

export const initialClaim: ClaimState = { phase: "idle", pending: 86, claimed: 50, sinceCalls: 43 };

export function claimReducer(state: ClaimState, action: ClaimAction): ClaimState {
  switch (action.type) {
    case "open":
      return state.phase === "idle" ? { ...state, phase: "confirm" } : state;
    case "cancel":
      return state.phase === "confirm" ? { ...state, phase: "idle" } : state;
    case "confirm":
      return state.phase === "confirm" ? { ...state, phase: "settling" } : state;
    case "settled":
      if (state.phase !== "settling") return state;
      return { phase: "done", pending: 0, claimed: state.claimed + state.pending, sinceCalls: 0 };
    case "reset":
      return initialClaim;
  }
}

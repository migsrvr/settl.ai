export type GateStatus = "idle" | "active" | "done" | "fail" | "blocked" | "skip";

export type Scenario = {
  label: string;
  receipt: string;
  before: string;
  after: string;
  final: Exclude<GateStatus, "idle" | "active">[];
  details: string[];
  earn: number;
  spend: number;
  tx: string | null;
};

export type StageState = {
  scenario: number;
  step: number;
  running: boolean;
  earned: number;
  budget: number;
  txs: string[];
  delta: boolean;
  ran: number[];
};

export const GATES = ["Quote", "Limits", "Sign", "Check", "Settle"];

export const STAGE_SCENARIOS: Scenario[] = [
  {
    label: "1. Clean receipt",
    receipt: "Receipt 1 of 3",
    before: "ResiboAI wants ₱2.00, only if the result passes. It’s on my list and under my limit. Paying.",
    after: "All five checks passed. Paid ₱2.00 and filed the expense.",
    final: ["done", "done", "done", "done", "done"],
    details: ["402, ₱2.00 on a passing result", "Allowed, under ₱5", "Signed, held back", "All 5 checks passed", "₱2.00 to ResiboAI"],
    earn: 2,
    spend: 2,
    tx: "authorize 3f9a…c21e",
  },
  {
    label: "2. Blurry receipt",
    receipt: "Receipt 2 of 3",
    before: "Same price, same terms. I’ll sign, and it only goes through if the result checks out.",
    after: "The result failed its checks, so nothing was charged. I’ll ask for a sharper photo.",
    final: ["done", "done", "done", "fail", "skip"],
    details: ["402, ₱2.00 on a passing result", "Allowed, under ₱5", "Signed, held back", "Confidence 0.62, needs 0.85", "Nothing charged"],
    earn: 0,
    spend: 0,
    tx: null,
  },
  {
    label: "3. Pro call, ₱15",
    receipt: "Receipt 3 of 3",
    before: "This one is faded. ResiboAI Pro charges ₱15.00 a call. Trying it.",
    after: "Stellar refused: ₱15.00 is over my ₱10.00 cap. Handing this one to Juan.",
    final: ["done", "blocked", "skip", "skip", "skip"],
    details: ["402, ₱15.00 per call", "Over the ₱10 cap on Stellar", "Never sent", "Never ran", "Nothing moved"],
    earn: 0,
    spend: 0,
    tx: null,
  },
];

export const initialStage: StageState = {
  scenario: -1,
  step: 0,
  running: false,
  earned: 4,
  budget: 46,
  txs: [],
  delta: false,
  ran: [],
};

/** How many gates a scenario walks through before it stops. */
export function stopAt(index: number): number {
  const skip = STAGE_SCENARIOS[index].final.indexOf("skip");
  return skip === -1 ? GATES.length : skip;
}

/** The finished state after running a scenario to the end. */
export function runStage(state: StageState, index: number): StageState {
  const s = STAGE_SCENARIOS[index];
  return {
    scenario: index,
    step: GATES.length,
    running: false,
    earned: state.earned + s.earn,
    budget: state.budget - s.spend,
    delta: s.earn > 0,
    txs: s.tx ? [s.tx, ...state.txs].slice(0, 4) : state.txs,
    ran: [...state.ran, index],
  };
}

export type Gate = { label: string; detail: string; status: GateStatus };

export function laneFor(state: StageState): Gate[] {
  const s = state.scenario >= 0 ? STAGE_SCENARIOS[state.scenario] : null;
  return GATES.map((label, i) => {
    let status: GateStatus = "idle";
    if (s) {
      if (i < state.step) status = s.final[i];
      else if (i === state.step && state.running) status = "active";
    }
    const shown = s && status !== "idle" && status !== "active";
    return {
      label: i === 4 && status === "skip" && s?.final[3] === "fail" ? "Not charged" : label,
      detail: shown ? s.details[i] : status === "active" ? "Working on it…" : "Not yet",
      status,
    };
  });
}

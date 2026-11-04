export type Check = { label: string; ok: boolean; note: string };

export type CallEvent = { text: string; time: string; tone: "info" | "good" | "bad" };

export type Call = {
  id: string;
  time: string;
  agent: string;
  org: string;
  endpoint: string;
  status: "paid" | "not";
  amount: number;
  tx: string;
  nonce: string;
};

export type CallFilter = "all" | "paid" | "not" | "blocked";

export const CALLS: Call[] = [
  { id: "call_3f9ac21e", time: "10:42", agent: "Juan’s Bookkeeper", org: "Juan’s Accounting", endpoint: "POST /parse-receipt", status: "paid", amount: 2, tx: "3f9a…c21e", nonce: "184471" },
  { id: "call_0b77d4a2", time: "10:41", agent: "Juan’s Bookkeeper", org: "Juan’s Accounting", endpoint: "POST /parse-receipt", status: "not", amount: 0, tx: "None, the signed payment was discarded", nonce: "184470" },
  { id: "call_a1c077b2", time: "10:40", agent: "Acme Dispatch Agent", org: "Acme Logistics", endpoint: "POST /parse-receipt", status: "paid", amount: 2, tx: "a1c0…77b2", nonce: "20931" },
  { id: "call_9be40d13", time: "10:38", agent: "Juan’s Bookkeeper", org: "Juan’s Accounting", endpoint: "POST /parse-receipt", status: "paid", amount: 2, tx: "9be4…0d13", nonce: "184469" },
  { id: "call_51aae9f0", time: "10:35", agent: "Acme Dispatch Agent", org: "Acme Logistics", endpoint: "POST /parse-receipt", status: "paid", amount: 2, tx: "51aa…e9f0", nonce: "20930" },
];

export const CALL_TABS: { id: CallFilter; label: string; count: number }[] = [
  { id: "all", label: "All", count: 68 },
  { id: "paid", label: "Paid", count: 62 },
  { id: "not", label: "Not charged", count: 6 },
  { id: "blocked", label: "Blocked", count: 0 },
];

export function filterCalls(filter: CallFilter): Call[] {
  return CALLS.filter((c) => filter === "all" || c.status === filter);
}

const PASS_CHECKS: Check[] = [
  { label: "Matches the receipt schema", ok: true, note: "v1" },
  { label: "Required fields present", ok: true, note: "4 of 4" },
  { label: "Confidence", ok: true, note: "0.97" },
  { label: "Line items add up", ok: true, note: "₱398.00" },
  { label: "Date is plausible", ok: true, note: "Nov 7" },
];

const FAIL_CHECKS: Check[] = [
  { label: "Matches the receipt schema", ok: true, note: "v1" },
  { label: "Required fields present", ok: true, note: "4 of 4" },
  { label: "Confidence", ok: false, note: "0.62, needs 0.85" },
  { label: "Line items add up", ok: false, note: "₱412.50 vs ₱398.00" },
  { label: "Date is plausible", ok: true, note: "Nov 7" },
];

export function checksFor(call: Call): Check[] {
  return call.status === "paid" ? PASS_CHECKS : FAIL_CHECKS;
}

export function eventsFor(call: Call): CallEvent[] {
  const t = call.time;
  const tail: CallEvent[] = [
    { text: "Agent signed the payment", time: `${t}:03`, tone: "info" },
    { text: "Within the agent’s limits", time: `${t}:03`, tone: "info" },
    { text: "Quoted ₱2.00 with HTTP 402", time: `${t}:02`, tone: "info" },
  ];
  return call.status === "paid"
    ? [
        { text: "Paid ₱2.00, claimable by ResiboAI", time: `${t}:05`, tone: "good" },
        { text: "All 5 checks passed", time: `${t}:05`, tone: "good" },
        ...tail,
      ]
    : [
        { text: "Not charged, signed payment discarded", time: `${t}:05`, tone: "bad" },
        { text: "2 of 5 checks failed", time: `${t}:05`, tone: "bad" },
        ...tail,
      ];
}

export const CLAIM_HISTORY = [
  { when: "Nov 6, 6:20 PM", amount: 38, tx: "e41b…92c0" },
  { when: "Nov 5, 9:05 PM", amount: 12, tx: "0a77…d4e1" },
];

export const CUSTOMERS = [
  { name: "Juan’s Accounting", agent: "Juan’s Bookkeeper", calls: 48, earned: 96 },
  { name: "Acme Logistics", agent: "Acme Dispatch Agent", calls: 14, earned: 28 },
];

export const ENDPOINTS = [
  { route: "POST /parse-receipt", note: "5 checks, confidence at least 0.85", price: 2, pays: "On a passing result", calls: 68 },
  { route: "POST /parse-receipt-pro", note: "Slower model for faded receipts", price: 15, pays: "On every call", calls: 0 },
];

export type Agent = {
  id: string;
  name: string;
  providers: string;
  status: "active" | "revoked";
  left: number;
  loaded: number;
  cap: number | null;
  expires: string;
  spentToday: number;
  note?: string;
};

export const AGENTS: Agent[] = [
  { id: "bookkeeper", name: "Juan’s Bookkeeper", providers: "ResiboAI and GeoPH", status: "active", left: 38, loaded: 50, cap: 10, expires: "Dec 31, 2026", spentToday: 12 },
  { id: "invoice-chaser", name: "Invoice Chaser", providers: "GeoPH and ResiboAI", status: "active", left: 20, loaded: 20, cap: 5, expires: "Nov 30, 2026", spentToday: 0 },
  { id: "old-scraper", name: "Old Scraper", providers: "₱6.00 returned to your wallet", status: "revoked", left: 0, loaded: 6, cap: null, expires: "Revoked Nov 4", spentToday: 0 },
];

export type ActivityKind = "paid" | "not" | "blocked" | "approval";
export type ActivityFilter = "all" | ActivityKind;

export type Activity = {
  kind: ActivityKind;
  amount: number;
  provider: string;
  detail: string;
  link?: { text: string; href: string; mono: boolean };
  time: string;
};

export const ACTIVITY: Activity[] = [
  { kind: "approval", amount: 8, provider: "GeoPH", detail: "Over your ₱5.00 limit for paying without asking.", link: { text: "Review", href: "/buyer/approvals/geoph", mono: false }, time: "10:44" },
  { kind: "paid", amount: 2, provider: "ResiboAI", detail: "All 5 checks passed.", link: { text: "3f9a…c21e", href: "https://stellar.expert/explorer/testnet", mono: true }, time: "10:42" },
  { kind: "not", amount: 0, provider: "ResiboAI", detail: "Confidence 0.62 and totals off, so you kept the ₱2.00.", time: "10:41" },
  { kind: "blocked", amount: 0, provider: "ResiboAI Pro", detail: "Stellar refused ₱15.00, above the ₱10.00 cap.", time: "10:39" },
  { kind: "paid", amount: 2, provider: "ResiboAI", detail: "All 5 checks passed.", link: { text: "9be4…0d13", href: "https://stellar.expert/explorer/testnet", mono: true }, time: "10:38" },
];

export const ACTIVITY_TABS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paid", label: "Paid" },
  { id: "not", label: "Not charged" },
  { id: "blocked", label: "Blocked" },
  { id: "approval", label: "Needs you" },
];

export function filterActivity(filter: ActivityFilter): Activity[] {
  return ACTIVITY.filter((a) => filter === "all" || a.kind === filter);
}

export const CONTRACTS = [
  { name: "device_registry", use: "Agent identity", id: "CB4DPM…OWIRA" },
  { name: "agent_registry", use: "Cap and expiry", id: "CBTDMJ…XQ25JZ" },
  { name: "payment_escrow", use: "Budgets and payouts", id: "CA5S4S…YK7HIX" },
];

export const STELLAR_EXPERT = "https://stellar.expert/explorer/testnet";

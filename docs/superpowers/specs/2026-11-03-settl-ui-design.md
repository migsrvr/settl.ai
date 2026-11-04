# Settl.ai: UI Design

- **Parent spec:** [`2026-11-03-settl-design.md`](2026-11-03-settl-design.md)
- **Status:** FINAL v1.0 (user flows approved; the clickable mockup is a separate artifact)
- **Decisions:**
  - **Platform: responsive web app**, desktop-first and usable on a phone. No native mobile app.
  - Fintech-clean look: white, indigo `#5B5BD6`, Inter, soft rounded cards
  - Light default with a dark toggle
  - All four surfaces in scope: provider dashboard, buyer console, stage view, landing page
  - No existing design system; Settl gets its own style
  - Every screen designed to fit a 1280×720 projector
  - Stretch: a phone-sized spend-approval page for the on-stage approval moment (flow B5)

---

## 1. User flows

### Roles

| Role | Human or system | Surface |
|---|---|---|
| **Provider** (ResiboAI, a startup selling an API) | Human | Provider dashboard |
| **Buyer** (Juan's Accounting, a company running agents) | Human | Buyer console |
| **Agent** (Juan's bookkeeping AI) | System, no UI | Shown through the activity feed and stage view |
| **Verifier** (Settl's judge) | System, no UI | Shown as check results |
| **Visitor / judge** | Human | Landing page and stage view |
| **Presenter** (you, on stage) | Human | Stage view, plus switching surfaces |

MVP has no login. A switcher in the top-left changes between Provider, Buyer and Stage. Each org's wallet is created and managed by Settl on testnet.

---

### 1.1 Provider (ResiboAI)

**P1. Onboard and earn the first peso**
```
Landing → "I sell an API" → Provider dashboard (empty state)
  → Create payout wallet (auto, testnet) ── "Settling on Stellar…" ──▶ ✓ Wallet ready
  → Add endpoint
      route: POST /parse-receipt
      price: ₱2.00
      mode: ( ) Per-call   (•) Pay-per-result
      criteria: [Receipt v1 ▾] → shows the 5 checks that will run
  → Copy SDK snippet (5 lines) + provider key
  → "Send a test request" (built-in sandbox agent)
  → Live feed shows the first call moving through the lane → ✓ Paid ₱2
```
**Done when:** the provider sees their first paid call without leaving the dashboard.

**P2. Daily check-in**
```
Overview → stat cards (Earned today · Pending claim · Calls · Pass rate)
  → Live feed row → click → Call detail drawer
      Lane: Quote ✓ → Policy ✓ → Pay ✓ → Verify ✓/✕ → Settled
      Quote: price, mode, nonce, expiry
      Payment: tx hash ↗ stellar.expert
      Verifier: checklist (✓ schema, ✓ fields, ✕ confidence 0.62 < 0.85 …)
      Customer: Juan's Accounting · agent: Juan's Bookkeeper
```

**P3. Claim earnings**
```
Earnings → Pending ₱86.00 → [Claim ₱86]
  → Confirm dialog: "Move ₱86 from escrow to your wallet G…X4F"
  → "Settling on Stellar… ~5s" (button disabled, progress)
  → ✓ "₱86 received" + tx ↗ → Pending becomes ₱0, the row appears in claim history
  ✕ on failure: "Claim didn't go through. Nothing moved." + [Try again] + error detail
```

**P4. Improve quality**
```
Quality → "Top failing checks: Confidence 7 · Totals 3 · Missing date 1"
  → click "Confidence" → list of failed calls → open one → see the input and output
  → (stretch) [Contest] → reason → review queue
```

**P5. Change pricing or mode**
```
Endpoints → endpoint card → Edit → price / mode / criteria → Save
  → Note: "Applies to new quotes only. Quotes already issued keep their price."
```

---

### 1.2 Buyer (Juan's Accounting)

**B1. Onboard and launch an agent**
```
Landing → "I run AI agents" → Buyer console (empty state)
  → Create org wallet (auto, testnet) ── ✓
  → New agent
      name: Juan's Bookkeeper
      Enforced on-chain:  cap ₱10 per payment · asset · expires Dec 31
      Enforced by Settl: allowed providers [ResiboAI] · max ₱5 per call · daily budget ₱20
  → Create → 2-step progress:
      ① Register agent identity (device_registry) ✓
      ② Set on-chain policy (agent_registry)     ✓
  → Credentials (shown once): agent secret + device hash
      [Copy] [Download .env]  ⚠ "Store this now. We won't show it again."
  → Prompt: "Your agent has ₱0. Top up to start." → B2
```

**B2. Top up the budget**
```
Agent detail → [Top up] → amount (₱50 · ₱100 · custom)
  → Redirect to Velo checkout (external) → pay
  → Return to Settl → "Waiting for payment confirmation…"
      (Velo webhook → fund_escrow on-chain)
  → ✓ "₱50 added to escrow" + tx ↗ → budget meter updates
  ✕ Cancelled at checkout → "Top-up cancelled. No charge." 
  ⏳ Webhook slow (>30s) → "Still confirming. You can leave this page; we'll update the balance."
```

**B3. Monitor spending**
```
Agents list (cards: budget meter, status, spent today)
  → Agent detail → Activity
      ✓ Paid       ResiboAI  ₱2
      ○ Not charged ResiboAI ₱0  (verify failed: confidence)
      ⛔ Blocked    ResiboAI-Pro ₱15 (over on-chain cap)
  → click a row → the same Call detail drawer as the provider sees (shared component)
```

**B4. Change the policy**
```
Agent detail → Policy → Edit
  Settl rules (allowlist, max per call, daily budget) → Save → applied instantly
  On-chain rules (cap, expiry) → Save → "Settling on Stellar…" → ✓ (a new transaction)
```

**B5. Approve a large spend** (stretch)
```
Notification "Bookkeeper wants to pay ₱12 to GeoPH (over your ₱5 auto-approve)"
  → [Approve once] / [Deny] → the agent continues or gets a "declined" result
```

**B6. Revoke an agent**
```
Agent detail → [Revoke agent] → Confirm: "Stops all payments and returns ₱38 to your wallet."
  → 3-step progress:
      ① Stop agent (revoke_agent)           ✓
      ② Return ₱38 (sweep_on_revoke)        ✓  tx ↗
      ③ Remove identity (device revoke)     ✓
  → Status: Revoked · Budget ₱0 · history kept (read-only)
```

---

### 1.3 Agent (system flow, what it decides)

```
Agent task: "parse receipt 3"
  → call ResiboAI /parse-receipt
  → response?
     200 → use result (free endpoint)
     402 → read quote (price, mode, criteria)
        → Policy check (off-chain): provider allowed? price ≤ max per call? daily budget left?
             ✕ → DECLINED → tool error "over budget / not allowed" → agent skips or flags it for a human
             ✓ → mode?
                per-call → sign + submit authorize → wait ~5s
                           on-chain rejects (cap/expiry/balance) → BLOCKED
                           ✓ → retry with proof → result + receipt (PAID)
                outcome  → pre-sign authorize (not sent) → retry with signed auth
                           → provider runs → verifier checks
                               pass → submitted → result + receipt (PAID)
                               fail → discarded → result marked unverified (NOT CHARGED)
                                      → agent decides: retry with a better image / skip / flag for a human
  → record expense → next receipt
```
Every arrow emits an event that the agent log, the buyer activity view, the provider feed and the stage view all show.

---

### 1.4 Verifier (system flow)

```
Receive { quote, signed auth, provider result }
  → Match: signed args == quote (agent, device, merchant, amount, nonce)?  ✕ → REJECT (no checks)
  → Run checks for the criteria (schema, fields, confidence, totals, date)
  → pass  → submit signed authorize via Velo gas → PAID → record + feed event
  → fail  → discard signed auth → NOT CHARGED → record reasons + feed event
  → error → no charge → flag for review
```

---

### 1.5 Visitor or judge

```
Landing
  hero: "Let AI agents pay your API, only for results that pass."
  → [Watch live demo] → Stage view (read-only, auto-play loop)
  → [I sell an API] → Provider dashboard
  → [I run AI agents] → Buyer console
  → any tx link → stellar.expert (proof it's real)
```

---

### 1.6 Presenter (you, on stage, following spec §13)

```
Before going on stage: pnpm seed → open 3 tabs: Stage · Provider · Buyer
Stage view:
  [▶ Run receipt 1: clean]      → lane all ✓ → ResiboAI +₱2 → budget ₱48
  [▶ Run receipt 2: blurry]     → lane stops at Verify ✕ → "Not charged"
  [▶ Run receipt 3: Pro ₱15]    → lane stops at Pay ⛔ → "Blocked by on-chain policy"
→ Buyer tab: [Top up ₱50] → Velo checkout → ✓ balance updates
→ Provider tab: Earnings → [Claim] → ✓ received + tx
→ Close on Landing hero
Fallback: the stage view has [Replay recorded run] if testnet is down
```

---

### 1.7 Screens these flows need

| Surface | Screens |
|---|---|
| Landing | Hero + 3 CTAs, "how it works" lane, 5-line snippet, footer with testnet contract IDs |
| Provider | Overview, Earnings, Endpoints (list + add/edit), Quality, Call detail drawer, empty states |
| Buyer | Agents list, New agent, Credentials dialog, Agent detail (budget, policy, activity), Top-up flow, Revoke dialog |
| Stage | Split view: agent thinking, earnings and budget, lane, tx ticker, run buttons, replay fallback |
| Shared | Top bar with role switcher + testnet badge + theme toggle, Lane, Status badge, Amount, Tx link, Budget meter, Check list, Settling indicator, Toasts |

---

## 2. Visual system (from emilkowalski/skills and Nutlope/hallmark)

Applied to the mockup on 2026-11-04. The build must follow the same rules.

### Type
- Body text: IBM Plex Sans 400 and 500, 16px minimum, line-height 1.5, measure under 65ch.
- Headings and big figures: Schibsted Grotesk 700, tracking -0.02em to -0.035em.
- Mono (IBM Plex Mono) only for code, hashes, nonces and route names.
- Three weights in total: 400, 500, 700.
- Scale is 1.25 from 16px: 13, 16, 20, 25, 31, 39, 49, 61.
- `tabular-nums` on all figures. `text-wrap: balance` on headings and `pretty` on body text. `font-synthesis: none`.
- Labels and table headers: 13px, sentence case, no letter-spacing. No uppercase labels.

### Colour: ink and saffron (palette D, chosen 2026-11-04)
| Token | Hex | Use |
|---|---|---|
| paper | #F5F4F0 | Page background |
| surface | #FDFCF9 | Sidebar, cards (never pure white) |
| well | #EFEDE7 | Hover and tinted areas |
| rule | #E3E1DA | Hairlines |
| field-edge | #8D8C88 | Input and quiet-button borders (3:1) |
| ink | #17181C | Text, primary buttons, links (underlined), chart lines, tab underline |
| ink-hover | #34353B | Primary button hover |
| ink-2 | #47484E | Secondary text |
| muted | #5A5B61 | Labels |
| on-ink | #F5F4F0 | Text on ink buttons and the testnet strip |
| saffron | #E9A92A | Accent: logo check, live increases (+₱2.00), progress bars. Fill only, never text. Under 5% of the screen. |
| saffron-well | #F8E7BF | Selected rows, active nav, chart area, budget-bar track |
| focus | #B07A0E | 2px outline, offset 2px, shown instantly |
| paid | #11643F on #E1F1E6 | Status |
| not charged | #3C3D42 on #EBEAE5 | Status |
| blocked | #A3271F on #F9E3DF | Status |
| needs you | #23456E on #E3EAF3 | Status (blue, so it never competes with saffron) |
| testnet strip | #F5F4F0 on #17181C | Full-width banner |

### Space and surfaces
- Spacing comes only from this scale: 2, 4, 8, 12, 16, 24, 40, 64, 96, 144.
- Surfaces, from lightest to heaviest: whitespace, then a 1px hairline, then a tinted well, then a card. A card has a border, never both a border and a shadow. No card inside a card.
- Tables have no box around them, horizontal rules only, and headers that don't wrap.
- Radii: 12px for cards, 8px for code, 6px for controls, 4px for pills.

### Motion
- Easing is `cubic-bezier(0.23, 1, 0.32, 1)`. Never `ease-in`, never `transition: all`.
- Animate `transform` and `opacity` only.
- Button press: `scale(0.97)` over 160ms.
- Panels and states enter with an 8px rise and fade over 220ms.
- Progress bars use `scaleX`, linear.
- Hover effects only inside `@media (hover:hover) and (pointer:fine)`.
- `prefers-reduced-motion` removes movement.
- No pulsing dots, no bounce, no parallax.

### Copy and patterns to avoid
- No "A · B · C" strings, no arrows stuck to links, no decorative status dots, no eyebrow text above headings.
- No emoji, no gradients, and no rows of equal icon tiles.
- Buttons name the action: "Claim ₱86.00", "Load budget", "Approve ₱8.00 once". "Continue" only as the second step of a flow.
- Errors and empty states say what happened and what to do next. No "Oops".
- No em dashes in UI copy. Use curly quotes and a real ellipsis (…).

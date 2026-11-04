import Link from "next/link";
import { ButtonLink, Logo, Pill } from "@/components/ui";
import { CONTRACTS } from "@/lib/demo-data";

const STEPS = [
  {
    title: "The buyer loads a budget",
    body: "Top up through Velo Checkout. The per-payment cap and expiry are written on-chain, so a misbehaving agent still can’t overspend.",
  },
  {
    title: "Your API names a price",
    body: "An unpaid call gets HTTP 402 with the price and the checks the result must pass. The agent decides whether it’s worth it.",
  },
  {
    title: "A verifier decides",
    body: "The agent signs the payment up front. Settl submits it only if the result passes. A blurry receipt costs nothing.",
  },
  {
    title: "You claim when you like",
    body: "Earnings wait in escrow. One claim moves them to your wallet, with the transaction as proof.",
  },
];

const RECEIPT = [
  ["Quote", "HTTP 402, ₱2.00 if the result passes"],
  ["Policy", "Allowed provider, under the ₱5 limit"],
  ["Payment", "Signed by the agent, held until checked"],
  ["Checks", "5 of 5 passed"],
];

const PROVIDER_CODE = `import { settl } from "settl-sdk";

app.post("/parse-receipt",
  settl({ price: "2.00", currency: "PHP",
          mode: "outcome", criteria: "resibo.receipt.v1" }),
  parseReceiptHandler);`;

const AGENT_CODE = `import { settlFetch } from "settl-client";

const res = await settlFetch(url, {
  method: "POST", body: image,
  wallet: agentKeypair, deviceHash,
  maxPrice: "5.00" });`;

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[1360px] items-center gap-10 px-10">
        <Link href="/" className="text-lg text-ink no-underline">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex gap-6 text-sm">
          <a href="#flow" className="text-ink-2 no-underline hover:text-ink">How money moves</a>
          <a href="#code" className="text-ink-2 no-underline hover:text-ink">Integration</a>
          <a href="#chain" className="text-ink-2 no-underline hover:text-ink">Contracts</a>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-ink">Sign in</Link>
          <ButtonLink href="/stage" variant="quiet">Watch the demo</ButtonLink>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1360px] grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] items-center gap-16 px-10 pb-36 pt-24">
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="max-w-[20ch] font-display text-5xl font-bold tracking-[-0.03em]">Let AI agents pay your API, per passing result.</h1>
          <p className="max-w-[52ch] text-lg text-ink-2">
            Agents spend from a prepaid budget with limits enforced on Stellar. You get paid per call, or only when the output passes checks both sides agreed on before any work started.
          </p>
          <div className="flex flex-wrap items-center gap-6 pt-2">
            <ButtonLink href="/login?next=/provider" variant="primary" size="lg">Price your API</ButtonLink>
            <Link href="/login?next=/buyer" className="font-medium text-ink">I run AI agents</Link>
          </div>
        </div>

        <figure aria-label="One paid call, as Settl records it" className="flex min-w-0 flex-col gap-4 rounded-xl border border-rule bg-surface p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">Juan’s Bookkeeper paid ResiboAI</span>
              <span className="font-display text-2xl font-bold tracking-[-0.02em]">₱2.00</span>
            </div>
            <Pill tone="paid">Paid</Pill>
          </div>
          <dl className="flex flex-col text-sm">
            {RECEIPT.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-t border-rule py-3">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-t border-rule py-3">
              <dt className="text-muted">Settled</dt>
              <dd className="font-mono">3f9a…c21e</dd>
            </div>
          </dl>
        </figure>
      </section>

      <section id="flow" className="border-t border-rule">
        <div className="mx-auto grid max-w-[1360px] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-16 px-10 py-36">
          <h2 className="max-w-[20ch] font-display text-3xl font-bold tracking-[-0.025em]">Money moves only after the work checks out.</h2>
          <ol className="flex flex-col border-b border-rule">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-t border-rule py-6">
                <span className="pt-1 font-mono text-sm text-muted">{i + 1}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-medium">{s.title}</span>
                  <span className="max-w-[60ch] text-ink-2">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="code" className="bg-well">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 py-36">
          <h2 className="max-w-[30ch] font-display text-3xl font-bold tracking-[-0.025em]">Five lines on your server. One function in the agent.</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-6">
            {[
              ["Provider, with settl-sdk", PROVIDER_CODE],
              ["Agent, with settl-client", AGENT_CODE],
            ].map(([label, code]) => (
              <div key={label} className="flex min-w-0 flex-col gap-2">
                <span className="text-xs text-ink-2">{label}</span>
                <pre className="overflow-x-auto rounded-lg bg-ink p-6 font-mono text-sm leading-relaxed text-code">{code}</pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="chain" className="mx-auto grid max-w-[1360px] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-16 px-10 pb-24 pt-36">
        <div className="flex flex-col gap-4">
          <h2 className="max-w-[20ch] font-display text-3xl font-bold tracking-[-0.025em]">Settles on Stellar, through Velo and Noir.</h2>
          <p className="max-w-[52ch] text-ink-2">Velo handles top-ups, webhook confirmation and network fees. Noir’s testnet contracts hold each agent’s identity, limits and escrow.</p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="border-b border-rule py-3 font-normal">Contract</th>
              <th scope="col" className="border-b border-rule py-3 font-normal">Used for</th>
              <th scope="col" className="border-b border-rule py-3 font-normal">Testnet ID</th>
            </tr>
          </thead>
          <tbody>
            {CONTRACTS.map((c) => (
              <tr key={c.name}>
                <td className="border-b border-rule py-4 pr-4 font-mono">{c.name}</td>
                <td className="border-b border-rule py-4 pr-4">{c.use}</td>
                <td className="border-b border-rule py-4 font-mono text-ink-2">{c.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="mx-auto flex max-w-[1360px] flex-wrap justify-between gap-4 border-t border-rule px-10 pb-10 pt-6 text-xs text-muted">
        <span>Settl.ai, built for the Velo x Noir Agentic Payment Hackathon</span>
        <span>Alpha on Stellar testnet. No real funds move.</span>
      </footer>
    </div>
  );
}

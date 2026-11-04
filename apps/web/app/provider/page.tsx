import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CallsPanel } from "@/components/provider/calls-panel";
import { Button, ButtonLink, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Home" };

function Sparkline({ points }: { points: string }) {
  return (
    <svg viewBox="0 0 120 24" width="100%" height="24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const FAILED = [
  ["Confidence too low", 7],
  ["Totals don’t add up", 3],
  ["Missing a required field", 1],
] as const;

export default function ProviderHome() {
  return (
    <AppShell role="provider" active="/provider">
      <PageHeader
        title="Today"
        actions={
          <>
            <Button>Send a test request</Button>
            <ButtonLink href="/provider/endpoints" variant="primary">Add an endpoint</ButtonLink>
          </>
        }
      />

      <section aria-label="Today in numbers" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 border-y border-rule py-6">
        <div className="flex flex-col gap-1">
          <Stat label="Earned" value="₱124.00" />
          <Sparkline points="0,22 15,21 30,19 45,20 60,14 75,12 90,9 105,7 120,3" />
        </div>
        <div className="flex flex-col gap-1">
          <Stat label="Paid calls" value="62" />
          <Sparkline points="0,21 15,20 30,18 45,18 60,15 75,11 90,9 105,8 120,4" />
        </div>
        <Stat label="Not charged" value="6" note="Results that failed your checks" />
        <Stat label="Pass rate" value="91.2%" note="62 of 68 results" />
      </section>

      <div className="flex flex-wrap items-start gap-10">
        <section aria-labelledby="chart-title" className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="chart-title" className="text-lg font-medium">Earnings so far today</h2>
            <span className="text-xs text-muted">In pesos</span>
          </div>
          <svg viewBox="0 0 600 160" width="100%" height="160" preserveAspectRatio="none" role="img" aria-label="Earnings rise steadily from ₱0 at midnight to ₱124 by 10:45 AM">
            {[40, 80, 120].map((y) => (
              <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--color-rule)" />
            ))}
            <path d="M0,158 L60,156 L120,150 L180,141 L240,128 L300,111 L360,96 L420,75 L480,56 L540,38 L600,24 L600,160 L0,160 Z" fill="var(--color-saffron-well)" />
            <polyline points="0,158 60,156 120,150 180,141 240,128 300,111 360,96 420,75 480,56 540,38 600,24" fill="none" stroke="var(--color-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="flex justify-between text-xs text-muted">
            <span>12 AM</span>
            <span>3 AM</span>
            <span>6 AM</span>
            <span>9 AM</span>
            <span>Now</span>
          </div>
        </section>

        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-6">
          <section aria-labelledby="pending-title" className="flex flex-col gap-2 rounded-xl border border-rule bg-surface p-6">
            <h2 id="pending-title" className="text-xs font-normal text-muted">Waiting in escrow</h2>
            <span className="text-2xl font-medium tracking-[-0.01em]">₱86.00</span>
            <ButtonLink href="/provider/earnings" className="mt-2 self-start">Claim earnings</ButtonLink>
          </section>
          <section aria-labelledby="fail-title" className="flex flex-col">
            <h2 id="fail-title" className="mb-2 text-sm font-medium">Most failed checks, last 7 days</h2>
            {FAILED.map(([label, n], i) => (
              <div key={label} className={`flex justify-between border-t border-rule py-2 ${i === FAILED.length - 1 ? "border-b" : ""}`}>
                <span>{label}</span>
                <span className="font-medium">{n}</span>
              </div>
            ))}
          </section>
        </div>
      </div>

      <CallsPanel />
    </AppShell>
  );
}

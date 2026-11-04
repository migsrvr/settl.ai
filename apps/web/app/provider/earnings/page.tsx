import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ClaimPanel } from "@/components/provider/claim-panel";
import { PageHeader } from "@/components/ui";
import { CUSTOMERS } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

export const metadata: Metadata = { title: "Earnings" };

export default function EarningsPage() {
  return (
    <AppShell role="provider" active="/provider/earnings">
      <PageHeader title="Earnings" lead="What agents pay you waits in escrow until you claim it to your wallet." />
      <ClaimPanel />

      <section aria-labelledby="cust-title" className="flex flex-col gap-2">
        <h2 id="cust-title" className="text-lg font-medium">Who paid you today</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">Customer</th>
                <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">Agent</th>
                <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 text-right font-normal">Paid calls</th>
                <th scope="col" className="whitespace-nowrap border-b border-rule py-2 text-right font-normal">Earned</th>
              </tr>
            </thead>
            <tbody>
              {CUSTOMERS.map((c) => (
                <tr key={c.name}>
                  <td className="border-b border-rule py-4 pr-4 font-medium">{c.name}</td>
                  <td className="border-b border-rule py-4 pr-4 text-ink-2">{c.agent}</td>
                  <td className="border-b border-rule py-4 pr-4 text-right">{c.calls}</td>
                  <td className="border-b border-rule py-4 text-right font-medium">{formatPeso(c.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

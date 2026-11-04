import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { AddRouteForm, IntegrateSection } from "@/components/provider/endpoint-tools";
import { PageHeader } from "@/components/ui";
import { ENDPOINTS } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

export const metadata: Metadata = { title: "Endpoints" };

export default function EndpointsPage() {
  return (
    <AppShell role="provider" active="/provider/endpoints">
      <PageHeader title="Endpoints" lead="Each route has a price. Agents see it, with the checks a result must pass, in the 402 quote before they pay." />

      <div className="flex flex-wrap items-start gap-10">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-10">
          <section aria-labelledby="ep-title" className="flex flex-col gap-2">
            <h2 id="ep-title" className="text-lg font-medium">Priced routes</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">Route</th>
                    <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">Price</th>
                    <th scope="col" className="whitespace-nowrap border-b border-rule py-2 pr-4 font-normal">Agents pay</th>
                    <th scope="col" className="whitespace-nowrap border-b border-rule py-2 text-right font-normal">Calls today</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.route}>
                      <td className="border-b border-rule py-4 pr-4">
                        <span className="flex flex-col gap-0.5">
                          <span className="font-mono text-sm">{e.route}</span>
                          <span className="text-xs text-muted">{e.note}</span>
                        </span>
                      </td>
                      <td className="border-b border-rule py-4 pr-4 font-medium">{formatPeso(e.price)}</td>
                      <td className="border-b border-rule py-4 pr-4">{e.pays}</td>
                      <td className="border-b border-rule py-4 text-right">{e.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <IntegrateSection />
        </div>
        <AddRouteForm />
      </div>
    </AppShell>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { AddRouteForm, IntegrateSection } from '@/components/provider/endpoint-tools';
import { PageHeader } from '@/components/ui';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { money } from '@/components/buyer/live-money';
import { loadProviderEndpoints } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Endpoints' };
async function LiveEndpoints() {
  const data = await loadProviderEndpoints();
  if (!data) return <DashboardUnavailable/>;
  return <div className="flex flex-wrap items-start gap-10">
    <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-10">
      <section><h2 className="mb-3 text-lg font-medium">Priced routes</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[600px]">
          <thead><tr className="text-left text-muted">{['Route', 'Price', 'Agents pay', 'Status', 'Calls today (UTC)'].map(h => <th key={h} scope="col" className="border-b border-rule py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
          <tbody>{data.endpoints.map(e => <tr key={e.id}>
            <td className="border-b border-rule py-4 pr-4"><div className="font-mono text-sm">{e.method} {e.route}</div><div className="text-muted">{e.name}</div></td>
            <td className="border-b border-rule py-4 pr-4">{money(e.price, data.rateCents)}</td>
            <td className="border-b border-rule py-4 pr-4">{e.mode === 'outcome' ? 'On a passing result' : 'On every call'}</td>
            <td className="border-b border-rule py-4 pr-4">{e.active ? 'Active' : 'Inactive'}</td>
            <td className="border-b border-rule py-4">{e.callsToday}</td>
          </tr>)}</tbody>
        </table></div>
        {data.endpoints.length === 0 && <p className="py-4">No priced routes yet.</p>}
      </section>
      <IntegrateSection endpoints={data.endpoints}/>
    </div>
    <AddRouteForm rateCents={data.rateCents}/>
  </div>;
}
export default function EndpointsPage() {
  return <AppShell role="provider" active="/provider/endpoints"><PageHeader title="Endpoints" lead="Each route has a price. Agents see its terms before they pay."/><Suspense fallback={<DashboardLoading/>}><LiveEndpoints/></Suspense></AppShell>;
}

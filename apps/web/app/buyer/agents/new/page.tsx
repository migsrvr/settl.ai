import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { NewAgentForm } from '@/components/buyer/new-agent-form';
import { DashboardLoading, DashboardUnavailable } from '@/components/buyer/live-state';
import { PageHeader } from '@/components/ui';
import { loadBuyerDashboard } from '@/lib/server/dashboard';
export const metadata: Metadata = { title: 'Create agent' };
async function LiveForm() { const data = await loadBuyerDashboard(); return data ? <NewAgentForm providers={data.providers} rateCents={data.rateCents}/> : <DashboardUnavailable/>; }
export default function NewAgentPage() { return <AppShell role="buyer" active="/buyer" crumbs={[{ href: '/buyer', label: 'Agents' }, { label: 'Create agent' }]}><PageHeader title="Create an agent" lead="Give it a prepaid budget and spending limits."/><Suspense fallback={<DashboardLoading/>}><LiveForm/></Suspense></AppShell>; }

import Link from 'next/link';
export function DashboardLoading() { return <p role="status" className="py-6 text-ink-2">Loading live dashboard…</p>; }
export function DashboardUnavailable() { return <div role="status" className="flex flex-col gap-4 py-6"><h2 className="text-lg font-medium">Live dashboard unavailable</h2><p>Sign in to the correct workspace, then reload. If this continues, check the database configuration.</p><Link href="/login" className="font-medium">Return to sign in</Link></div>; }

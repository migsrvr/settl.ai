import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { signOut, switchWorkspace } from "@/app/login/actions";
import { DEMO_ACCOUNTS, resolveSession, SESSION_COOKIE, type DemoAccount, type Role } from "@/lib/auth";
import { findWorkspaceAccount } from "@/lib/server/workspace-accounts";
import { Logo, Pill } from "@/components/ui";

type NavItem = { href: string; label: string; badge?: string };

const NAV: Record<Role, NavItem[]> = {
  provider: [
    { href: "/provider", label: "Home" },
    { href: "/provider/earnings", label: "Earnings" },
    { href: "/provider/endpoints", label: "Endpoints" },
  ],
  buyer: [
    { href: "/buyer", label: "Agents" },
    { href: "/buyer#activity", label: "Activity" },
    { href: "/buyer#approvals", label: "Approvals" },
  ],
};

function navClass(active: boolean) {
  return `flex min-h-10 items-center justify-between rounded-md px-3 no-underline ${
    active ? "bg-saffron-well font-medium text-ink" : "text-ink-2 hover:bg-well"
  }`;
}

type AppShellProps = {
  role: Role;
  active: string;
  crumbs?: { href?: string; label: string }[];
  children: ReactNode;
};

export function AppShell(props: AppShellProps) {
  // Request-time identity stays under Suspense with Next.js 16 Cache Components.
  return <Suspense fallback={<p role="status" className="p-10 text-ink-2">Loading workspace…</p>}><WorkspaceShell {...props} /></Suspense>;
}

async function WorkspaceShell({ role, active, crumbs, children }: AppShellProps) {
  const session = resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role !== role) redirect(`/${session.role}`);
  let workspace: DemoAccount | null;
  try { workspace = await findWorkspaceAccount(session.email); }
  catch { return <p role="alert" className="p-10 text-ink-2">Workspace is unavailable. Reload the page or sign in again.</p>; }
  const account = workspace;
  if (!account || account.role !== role) redirect("/login");
  const searchHint = role === "provider" ? "Search calls, agents or transaction hashes" : "Search agents, providers or transaction hashes";

  return (
    <div className="min-h-dvh">
      <p role="note" className="border-b border-ink bg-ink px-4 py-2 text-center text-xs text-on-ink">
        Testnet. Payments settle on Stellar testnet and no real funds move.
      </p>

      <div className="flex flex-wrap items-stretch">
        <aside className="flex flex-[1_1_240px] flex-col gap-6 border-r border-rule bg-surface px-3 pb-6 pt-4">
          <div className="flex min-h-12 items-center gap-3 px-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-medium text-on-ink">
              {account.org[0]}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="font-medium">{account.org}</span>
              <span className="text-xs text-muted">{role === "provider" ? "Provider" : "Buyer"}</span>
            </span>
          </div>

          <nav aria-label={role === "provider" ? "Provider" : "Buyer"} className="flex flex-col gap-0.5">
            {NAV[role].map((item) => (
              <Link key={item.href} href={item.href} aria-current={item.href === active ? "page" : undefined} className={navClass(item.href === active)}>
                {item.label}
                {item.badge ? <Pill tone="info">{item.badge}</Pill> : null}
              </Link>
            ))}
          </nav>

          <nav aria-label="Switch workspace" className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-xs text-muted">Switch workspace</span>
            {DEMO_ACCOUNTS.filter((workspace) => workspace.email !== account.email).map((workspace) => (
              <form key={workspace.email} action={switchWorkspace.bind(null, workspace.email)}>
                <button type="submit" className={`press w-full gap-2 text-left ${navClass(false)}`}>
                  <span>{workspace.org}</span>
                  <span className="rounded bg-well px-2 py-0.5 text-xs text-muted">{workspace.role === "provider" ? "Provider" : "Buyer"}</span>
                </button>
              </form>
            ))}
            <Link href="/stage" className={navClass(false)}>Stage view</Link>
          </nav>

          <div className="mt-auto flex flex-col gap-2">
            <form action={signOut}>
              <button type="submit" className="press flex min-h-10 w-full items-center rounded-md px-3 text-left text-ink-2 hover:bg-well">
                Sign out
              </button>
            </form>
            <Link href="/" className="px-3 py-2 text-ink no-underline">
              <Logo size={20} />
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col">
          <div className="flex min-h-16 flex-wrap items-center gap-4 border-b border-rule bg-surface px-10 py-3">
            {crumbs ? (
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-muted">
                {crumbs.map((c, i) => (
                  <span key={c.label} className="flex items-center gap-2">
                    {i > 0 ? <span aria-hidden="true">/</span> : null}
                    {c.href ? (
                      <Link href={c.href} className="no-underline hover:text-ink">
                        {c.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : (
              <form method="get" action={role === "provider" ? "/provider" : "/buyer"} className="flex min-h-10 max-w-[420px] flex-[1_1_260px] items-center gap-2 rounded-md border border-edge px-3 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <label htmlFor="workspace-search" className="sr-only">Search</label>
                <input id="workspace-search" type="search" name="q" maxLength={200} placeholder={searchHint} className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
                <button type="submit" className="press min-h-10 text-sm font-medium text-ink">Search</button>
              </form>
            )}
            <Pill tone="info" className="ml-auto">
              Testnet
            </Pill>
            <span
              role="img"
              aria-label={`${account.name}, ${account.org}`}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                role === "provider" ? "bg-saffron-well text-ink" : "bg-paid-bg text-paid"
              }`}
            >
              {account.initials}
            </span>
          </div>

          <main className="box-border flex w-full max-w-[1200px] flex-col gap-10 p-10">{children}</main>
        </div>
      </div>
    </div>
  );
}

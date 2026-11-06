import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { accountFor, type Role } from "@/lib/auth";
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

const OTHER: Record<Role, NavItem[]> = {
  provider: [
    { href: "/buyer", label: "Buyer console" },
    { href: "/stage", label: "Stage view" },
  ],
  buyer: [
    { href: "/provider", label: "Provider dashboard" },
    { href: "/stage", label: "Stage view" },
  ],
};

function navClass(active: boolean) {
  return `flex min-h-10 items-center justify-between rounded-md px-3 no-underline ${
    active ? "bg-saffron-well font-medium text-ink" : "text-ink-2 hover:bg-well"
  }`;
}

export function AppShell({
  role,
  active,
  crumbs,
  children,
}: {
  role: Role;
  active: string;
  crumbs?: { href?: string; label: string }[];
  children: ReactNode;
}) {
  const account = accountFor(role);
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

          <div className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-xs text-muted">Other views</span>
            {OTHER[role].map((item) => (
              <Link key={item.href} href={item.href} className={navClass(false)}>
                {item.label}
              </Link>
            ))}
          </div>

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

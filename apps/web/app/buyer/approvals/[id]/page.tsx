import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalCard } from "@/components/buyer/approval-card";

const APPROVALS = ["geoph"];

export function generateStaticParams() {
  return APPROVALS.map((id) => ({ id }));
}

export const metadata: Metadata = { title: "Approval" };

// Designed for a phone: the buyer gets this as a notification while the agent waits.
export default async function ApprovalPage({ params }: PageProps<"/buyer/approvals/[id]">) {
  const { id } = await params;
  if (!APPROVALS.includes(id)) notFound();

  return (
    <div className="mx-auto box-border flex min-h-dvh w-full max-w-[420px] flex-col gap-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/buyer/agents/bookkeeper"
          aria-label="Back to Juan’s Bookkeeper"
          className="press inline-flex size-11 items-center justify-center rounded-lg border border-edge text-ink hover:bg-well"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <span className="font-display text-lg font-bold tracking-[-0.02em]">Approval</span>
        <span className="ml-auto text-xs text-muted">Juan’s Accounting</span>
      </div>
      <ApprovalCard />
    </div>
  );
}

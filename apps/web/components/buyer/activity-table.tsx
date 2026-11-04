"use client";

import Link from "next/link";
import { useState } from "react";
import { Pill, TabBar, type Tone } from "@/components/ui";
import { ACTIVITY_TABS, filterActivity, type ActivityFilter, type ActivityKind } from "@/lib/demo-data";
import { formatPeso } from "@/lib/format";

const COLS = "grid grid-cols-[96px_144px_120px_minmax(0,1fr)_64px] gap-4";

const STATUS: Record<ActivityKind, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "paid" },
  not: { label: "Not charged", tone: "neutral" },
  blocked: { label: "Blocked", tone: "blocked" },
  approval: { label: "Needs you", tone: "info" },
};

export function ActivityTable() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const rows = filterActivity(filter);

  return (
    <section aria-labelledby="act-title" className="flex flex-col gap-2">
      <h2 id="act-title" className="text-lg font-medium">Activity</h2>
      <TabBar label="Filter activity" tabs={ACTIVITY_TABS} value={filter} onChange={setFilter} />
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`${COLS} border-b border-rule py-2 text-xs text-muted`}>
            <span>Amount</span>
            <span>Status</span>
            <span>Provider</span>
            <span>Why</span>
            <span className="text-right">Time</span>
          </div>
          {rows.map((r) => (
            <div key={`${r.time}-${r.kind}`} className={`${COLS} min-h-14 items-center border-b border-rule py-2 ${r.kind === "approval" ? "bg-info-tint" : ""}`}>
              <span className="font-medium">{formatPeso(r.amount)}</span>
              <span>
                <Pill tone={STATUS[r.kind].tone}>{STATUS[r.kind].label}</Pill>
              </span>
              <span>{r.provider}</span>
              <span className="min-w-0 text-ink-2">
                {r.detail}
                {r.link ? (
                  <>
                    {" "}
                    {r.link.href.startsWith("/") ? (
                      <Link href={r.link.href} className="font-medium text-ink">
                        {r.link.text}
                      </Link>
                    ) : (
                      <a href={r.link.href} className={r.link.mono ? "font-mono text-sm text-ink" : "font-medium text-ink"}>
                        {r.link.text}
                      </a>
                    )}
                  </>
                ) : null}
              </span>
              <span className="text-right text-muted">{r.time}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

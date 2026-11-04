import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink-hover",
  quiet: "border border-edge bg-transparent text-ink hover:bg-well",
  danger: "border border-blocked-edge bg-transparent text-blocked hover:bg-blocked-bg",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
};

export function buttonClass(variant: Variant = "quiet", size: Size = "md", extra = "") {
  return `press inline-flex items-center justify-center gap-2 rounded-md font-medium no-underline ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "quiet",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "quiet",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export type Tone = "paid" | "neutral" | "blocked" | "info" | "accent";

const TONES: Record<Tone, string> = {
  paid: "bg-paid-bg text-paid",
  neutral: "bg-neutral-bg text-neutral",
  blocked: "bg-blocked-bg text-blocked",
  info: "bg-info-bg text-info",
  accent: "bg-saffron-well text-ink",
};

export function Pill({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-bold tracking-[-0.02em] ${className}`}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="var(--color-ink)" />
        <path d="M7 12.5l3.2 3.2L17 8.6" fill="none" stroke="var(--color-saffron)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Settl.ai
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-saffron-well border-t-ink"
      style={{ width: size, height: size }}
    />
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-sm ${className}`}>{children}</span>;
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-medium tracking-[-0.01em]">{value}</span>
      {note ? <span className="text-xs text-muted">{note}</span> : null}
    </div>
  );
}

export function PageHeader({ title, lead, actions }: { title: ReactNode; lead?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</h1>
        {lead ? <p className="max-w-[65ch] text-ink-2">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Meter({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={`h-1 overflow-hidden rounded-sm bg-saffron-well ${className}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TabBar<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto border-b border-rule">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`-mb-px min-h-10 whitespace-nowrap border-b-2 text-sm ${on ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
            {t.count !== undefined ? <span className="text-muted"> {t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

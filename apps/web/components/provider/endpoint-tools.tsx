"use client";

import { useState, type FormEvent } from "react";
import { Button, TabBar } from "@/components/ui";

const CODE = {
  express: `import { settl } from "settl-sdk";

app.post("/parse-receipt",
  settl({ endpointId: "ep_parse_receipt" }),
  parseReceiptHandler);`,
  next: `import { withSettl } from "settl-sdk/next";

export const POST = withSettl(
  { endpointId: "ep_parse_receipt" },
  parseReceiptHandler);`,
};

type Framework = keyof typeof CODE;

export function IntegrateSection() {
  const [fw, setFw] = useState<Framework>("express");
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(CODE[fw]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section aria-labelledby="int-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h2 id="int-title" className="text-lg font-medium">Add Settl to your server</h2>
          <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy code"}</Button>
        </div>
        <TabBar
          label="Framework"
          tabs={[
            { id: "express", label: "Express" },
            { id: "next", label: "Next.js" },
          ]}
          value={fw}
          onChange={(id) => {
            setFw(id);
            setCopied(false);
          }}
        />
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-6 font-mono text-sm leading-relaxed text-code">{CODE[fw]}</pre>
      </section>

      <section aria-labelledby="keys-title" className="flex flex-col gap-2">
        <h2 id="keys-title" className="text-lg font-medium">Provider key</h2>
        <div className="flex flex-wrap items-center gap-4 border-y border-rule py-4">
          <span className="min-w-0 flex-[1_1_280px] overflow-x-auto whitespace-nowrap font-mono text-sm">
            {showKey ? "stl_test_[YOUR PROVIDER KEY]" : "stl_test_••••••••••••••••4f2a"}
          </span>
          <span className="text-xs text-muted">Set as SETTL_PROVIDER_KEY. Created Nov 5.</span>
          <Button onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide key" : "Reveal key"}</Button>
        </div>
      </section>
    </>
  );
}

const MODES = [
  { id: "outcome", title: "Only on a passing result", desc: "Settl on Result. The agent signs first, Settl submits after your checks pass." },
  { id: "per-call", title: "On every call", desc: "The agent pays before your handler runs." },
] as const;

export function AddRouteForm() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("outcome");
  const [route, setRoute] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<{ route?: string; price?: string }>({});
  const [added, setAdded] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^(GET|POST|PUT|PATCH|DELETE) \/\S+$/.test(route.trim())) next.route = "Use a method and a path, like POST /translate.";
    const n = Number(price);
    if (!price || Number.isNaN(n) || n <= 0) next.price = "Enter a price above ₱0, like 2.00.";
    setErrors(next);
    if (next.route) return document.getElementById("route")?.focus();
    if (next.price) return document.getElementById("price")?.focus();
    setAdded(`${route.trim()} at ₱${n.toFixed(2)}`);
    setRoute("");
    setPrice("");
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-xl border border-rule bg-surface p-6">
      <h2 id="new-title" className="text-lg font-medium">Price a new route</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="route" className="text-sm font-medium">Route</label>
        <input
          id="route"
          name="route"
          autoComplete="off"
          placeholder="POST /translate"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          aria-invalid={errors.route ? true : undefined}
          aria-describedby="route-help"
          className="min-h-10 rounded-md border border-edge bg-surface px-3 font-mono text-sm"
        />
        <span id="route-help" className="min-h-[1lh] text-xs text-blocked">{errors.route}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="price" className="text-sm font-medium">Price per call, in pesos</label>
        <input
          id="price"
          name="price"
          inputMode="decimal"
          autoComplete="off"
          placeholder="2.00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-invalid={errors.price ? true : undefined}
          aria-describedby="price-help"
          className="min-h-10 rounded-md border border-edge bg-surface px-3"
        />
        <span id="price-help" className="min-h-[1lh] text-xs text-blocked">{errors.price}</span>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">When agents pay</legend>
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${on ? "border-ink bg-saffron-well" : "border-rule"}`}>
              <input type="radio" name="mode" value={m.id} checked={on} onChange={() => setMode(m.id)} className="mt-1 size-4 accent-ink" />
              <span className="flex flex-col">
                <span className="font-medium">{m.title}</span>
                <span className="text-xs text-ink-2">{m.desc}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {mode === "outcome" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="criteria" className="text-sm font-medium">Checks a result must pass</label>
          <select id="criteria" name="criteria" className="min-h-10 rounded-md border border-edge bg-surface px-2">
            <option>Receipt v1, 5 checks</option>
            <option>Your own JSON schema</option>
          </select>
        </div>
      )}
      <Button type="submit" variant="primary">Add route</Button>
      <span className="text-xs text-muted" aria-live="polite">
        {added ? `Added ${added}. It’s live for new quotes in this demo session.` : "New prices apply to quotes issued after you save."}
      </span>
    </form>
  );
}

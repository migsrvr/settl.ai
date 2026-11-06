"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, type LoginState } from "@/app/login/actions";
import { DEMO_ACCOUNTS, type Role } from "@/lib/auth";
import { Button, Spinner } from "@/components/ui";

const PREVIEW: Record<Role, { title: string; points: string[] }> = {
  provider: {
    title: "provider dashboard",
    points: ["Live calls from AI agents and what each one paid", "Earnings waiting in escrow, claimed in one step", "Routes, prices and the checks a result must pass"],
  },
  buyer: {
    title: "buyer console",
    points: ["Each agent’s prepaid budget and limits", "What agents paid for, and what they didn’t", "Approvals for spends above your limit"],
  },
};

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const picked = DEMO_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());
  const preview = PREVIEW[picked?.role ?? "provider"];

  useEffect(() => {
    if (state.error?.field === "email") emailRef.current?.focus();
    if (state.error?.field === "password") passwordRef.current?.focus();
  }, [state]);

  const emailError = state.error?.field === "email" ? state.error.message : null;
  const passwordError = state.error?.field === "password" ? state.error.message : null;

  return (
    <div className="grid w-full max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-10">
      <form action={action} noValidate className="flex flex-col gap-6">
        <input type="hidden" name="next" value={params.get("next") ?? ""} />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold tracking-[-0.025em]">Sign in to Settl</h1>
          <p className="text-ink-2">Pick a demo workspace, or type its email.</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Demo workspaces</legend>
          {DEMO_ACCOUNTS.map((a) => {
            const on = picked?.email === a.email;
            return (
              <button
                key={a.email}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setEmail(a.email);
                  setPassword("demo-password");
                }}
                className={`press flex items-center gap-3 rounded-md border p-3 text-left ${on ? "border-ink bg-saffron-well" : "border-rule hover:bg-well"}`}
              >
                <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${a.role === "provider" ? "bg-saffron-well text-ink" : "bg-paid-bg text-paid"}`}>
                  {a.initials}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-medium">
                    {a.name}, {a.org}
                  </span>
                  <span className="text-xs text-muted">
                    {a.role === "provider" ? "Sells an API to agents" : "Runs AI agents that pay for tools"}
                  </span>
                </span>
              </button>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="mara@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby="email-help"
            className="min-h-10 rounded-md border border-edge bg-surface px-3 text-base"
          />
          <span id="email-help" className={`min-h-[1lh] text-xs ${emailError ? "text-blocked" : "text-muted"}`}>
            {emailError ?? "Choose a workspace above, or enter an existing demo organization’s email."}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby="password-help"
            className="min-h-10 rounded-md border border-edge bg-surface px-3 text-base"
          />
          <span id="password-help" className={`min-h-[1lh] text-xs ${passwordError ? "text-blocked" : "text-muted"}`}>
            {passwordError ?? "Any password works in the demo."}
          </span>
        </div>

        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? (
            <>
              <Spinner size={16} />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
        <p className="text-xs text-muted">Demo sign-in. Settl stores only which workspace you picked, in a cookie on this browser.</p>
      </form>

      <section aria-labelledby="preview-title" className="flex flex-col gap-4 self-start rounded-xl border border-rule bg-surface p-6">
        <h2 id="preview-title" className="text-lg font-medium">
          You’ll see {picked ? `${picked.org}’s ${preview.title}` : "your workspace"}
        </h2>
        <ul className="flex flex-col">
          {preview.points.map((p) => (
            <li key={p} className="border-t border-rule py-3 text-ink-2">
              {p}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">Switch workspaces any time from the sidebar.</p>
      </section>
    </div>
  );
}

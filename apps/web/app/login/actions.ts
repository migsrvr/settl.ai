"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountForEmail, resolveSession, SESSION_COOKIE, type DemoAccount } from "@/lib/auth";
import { findWorkspaceAccount } from "@/lib/server/workspace-accounts";

export type LoginState = { error?: { field: "email" | "password"; message: string }; email?: string };

async function setWorkspaceSession(account: DemoAccount) {
  // Known emails derive their role from the catalog; custom DB accounts carry a role hint.
  // Protected server operations still check the actual stored organization role.
  const value = accountForEmail(account.email) ? account.email : `${account.role}:${account.email}`;
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8,
  });
}

function returnDestination(next: string, account: DemoAccount): string {
  try {
    const base = "https://settl.invalid";
    const target = new URL(next, base);
    if (target.origin === base && (target.pathname === account.home || target.pathname.startsWith(`${account.home}/`))) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch { /* Invalid or cross-workspace return locations use the selected home. */ }
  return account.home;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email.trim()) return { email, error: { field: "email", message: "Enter your email." } };
  if (!password) return { email, error: { field: "password", message: "Enter any password. The demo doesn’t check it." } };
  let account: DemoAccount | null;
  try { account = await findWorkspaceAccount(email); }
  catch { return { email, error: { field: "email", message: "Workspace lookup is unavailable. Try again shortly." } }; }
  if (!account) {
    return { email, error: { field: "email", message: "No demo workspace uses that email. Choose a workspace above or enter an existing organization’s email." } };
  }
  await setWorkspaceSession(account);
  redirect(returnDestination(next, account));
}

export async function switchWorkspace(email: string): Promise<never> {
  if (!resolveSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");
  let account: DemoAccount | null;
  try { account = await findWorkspaceAccount(email); }
  catch { redirect("/login"); }
  if (!account) redirect("/login");
  await setWorkspaceSession(account);
  redirect(account.home);
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

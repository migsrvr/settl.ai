"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveDemoAccount, SESSION_COOKIE } from "@/lib/auth";

export type LoginState = { error?: { field: "email" | "password"; message: string }; email?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email.trim()) return { email, error: { field: "email", message: "Enter your email." } };
  const account = resolveDemoAccount(email);
  if (!account) {
    return { email, error: { field: "email", message: "That email isn’t a demo account. Use one of the two above." } };
  }
  if (!password) return { email, error: { field: "password", message: "Enter any password. The demo doesn’t check it." } };

  (await cookies()).set(SESSION_COOKIE, account.role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  const allowed = next.startsWith(`/${account.role}`) ? next : account.home;
  redirect(allowed);
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

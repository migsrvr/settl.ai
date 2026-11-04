import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1360px] items-center px-10">
        <Link href="/" className="text-lg text-ink no-underline">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 justify-center px-10 py-16">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}

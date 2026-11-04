import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// Optimistic demo check only: the cookie holds a role, not a real session.
export function proxy(request: NextRequest) {
  const role = request.cookies.get(SESSION_COOKIE)?.value;
  if (role === "provider" || role === "buyer") return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/provider/:path*", "/buyer/:path*"],
};

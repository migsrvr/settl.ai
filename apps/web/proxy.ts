import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE } from "@/lib/auth";

// Optimistic demo routing only; protected data access verifies the stored org role.
export function proxy(request: NextRequest) {
  const session = resolveSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    const pathname = request.nextUrl.pathname;
    const buyerRoute = pathname === "/buyer" || pathname.startsWith("/buyer/");
    const providerRoute = pathname === "/provider" || pathname.startsWith("/provider/");
    if (buyerRoute && session.role !== "buyer") return NextResponse.redirect(new URL("/provider", request.url));
    if (providerRoute && session.role !== "provider") return NextResponse.redirect(new URL("/buyer", request.url));
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/provider/:path*", "/buyer/:path*"],
};

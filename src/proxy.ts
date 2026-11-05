import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/security/csp";
import { SESSION_COOKIE } from "@/lib/session-cookie";

const PUBLIC_PATHS = ["/login", "/design"];

export function proxy(request: NextRequest) {
  // A quick redirect for visitors with no session cookie at all. This is not the
  // security check: requireSession() validates the session against the database.
  const isPublic = PUBLIC_PATHS.includes(request.nextUrl.pathname);
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Next.js reads the nonce from the request's CSP header and applies it to its
  // own scripts during rendering. Every page gets a fresh one.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Prefetches are included, because they can also return a page that needs the policy.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};

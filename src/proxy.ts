import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/security/csp";

/** Gives every page request a fresh nonce and a CSP that requires it. */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  // Next.js reads the nonce from the request's CSP header and applies it to
  // its own scripts during rendering.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  // Generate a per-request nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://www.googleadservices.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob: https://www.googletagmanager.com https://www.facebook.com",
    "font-src 'self' https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.stripe.com https://api.stripe.com https://www.google-analytics.com https://www.googletagmanager.com https://analytics.google.com https://connect.facebook.net https://www.facebook.com https://googleads.g.doubleclick.net https://www.googleadservices.com",
    "frame-src 'self' https://*.stripe.com https://js.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.stripe.com",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

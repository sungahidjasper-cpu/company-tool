import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/companies",
  "/users",
  "/clients",
  "/leads",
  "/pipeline",
  "/projects",
  "/seo",
  "/ai",
  "/reports",
  "/settings",
  "/profile",
  "/search",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtectedRoute && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Deliberately does NOT redirect an already-authenticated visitor away from
  // /login here. getToken() only decrypts the JWT — it can't run the jwt
  // callback's live securityVersion check (lib/auth.ts's getCurrentUser()
  // does), so a stale-but-still-decryptable cookie would make this redirect
  // fire even when requireUser() correctly considers the session invalid,
  // bouncing /login -> /dashboard -> /login forever. /login's own page
  // component already performs the equivalent (DB-validated) redirect via
  // getCurrentUser(), so this middleware-level shortcut is redundant for the
  // valid-session case and actively harmful for the stale-cookie case.

  const response = NextResponse.next();
  if (isProtectedRoute) {
    // Next already sends "no-cache, must-revalidate" automatically for
    // these (they all read cookies via requireUser()); no-store is the
    // stronger, standard signal specifically against back-button replay
    // of authenticated content after logout.
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

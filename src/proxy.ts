import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/middleware";
export function proxy(request: NextRequest) {
  // Cron endpoints authenticate their own server-only bearers. PWA assets
  // must also work without a session, including after the app tab closes.
  if (["/api/cron/storage-cleanup", "/api/cron/notifications", "/push-worker.js", "/manifest.webmanifest"].includes(request.nextUrl.pathname))
    return NextResponse.next();
  return updateSession(request);
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

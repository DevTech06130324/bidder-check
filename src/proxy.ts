import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/middleware";
export function proxy(request: NextRequest) {
  // This endpoint authenticates the server-only cron bearer itself.
  if (request.nextUrl.pathname === "/api/cron/storage-cleanup")
    return NextResponse.next();
  return updateSession(request);
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

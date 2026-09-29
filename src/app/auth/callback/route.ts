import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next =
    request.nextUrl.searchParams.get("next") === "/auth/update-password"
      ? "/auth/update-password"
      : "/dashboard";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(
    new URL(
      "/auth/login?error=Your+link+is+invalid+or+expired.+Please+request+a+new+one.",
      request.url,
    ),
  );
}

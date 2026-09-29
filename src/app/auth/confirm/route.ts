import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/server";
import type { EmailOtpType } from "@supabase/supabase-js";
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (
    token_hash &&
    type &&
    ["signup", "invite", "recovery", "email"].includes(type)
  ) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    if (!error)
      return NextResponse.redirect(
        new URL(
          ["invite", "recovery"].includes(type)
            ? "/auth/update-password"
            : "/dashboard",
          request.url,
        ),
      );
  }
  return NextResponse.redirect(
    new URL(
      "/auth/login?error=Your+link+is+invalid+or+expired.+Please+request+a+new+one.",
      request.url,
    ),
  );
}

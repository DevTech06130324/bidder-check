import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export function adminClient(bounded = false) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key)
    throw new Error(
      "Server setup is incomplete: add SUPABASE_SECRET_KEY to enable account creation and verified uploads.",
    );
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(bounded
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
          },
        }
      : {}),
  });
}

import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);
const { error } = await supabase.from("profiles").select("id").limit(1);
console.log(
  "Database schema:",
  error ? `${error.code}: ${error.message}` : "available",
);
if (process.env.SUPABASE_SECRET_KEY) {
  const { data, error: authError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  console.log(
    "Auth administration:",
    authError ? authError.message : "available",
  );
  const admin = data?.users.find(
    (u) => u.email === "david.chan.mdev@gmail.com",
  );
  console.log(
    "Designated admin:",
    admin
      ? admin.email_confirmed_at
        ? "verified account exists"
        : "account needs email verification"
      : "not registered yet",
  );
}

import { createClient } from "@supabase/supabase-js";
const email = process.argv[2] ?? "david.chan.mdev@gmail.com";
if (!process.env.SUPABASE_SECRET_KEY)
  throw new Error(
    "Set SUPABASE_SECRET_KEY in .env.local before bootstrapping an administrator.",
  );
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: profile, error } = await supabase
  .from("profiles")
  .select("id,role")
  .eq("email", email)
  .single();
if (error || !profile)
  throw new Error(
    "Register this email in the app and verify it first. No accounts were changed.",
  );
const {
  data: { user },
  error: authError,
} = await supabase.auth.admin.getUserById(profile.id);
if (authError || !user?.email_confirmed_at)
  throw new Error(
    "The account must have a verified email. No accounts were changed.",
  );
if (profile.role === "bidder")
  throw new Error(
    "Cannot promote a bidder membership; use a dedicated administrator account.",
  );
const { error: updateError } = await supabase
  .from("profiles")
  .update({ role: "admin" })
  .eq("id", profile.id);
if (updateError) throw updateError;
console.log(`Administrator enabled for ${email}.`);

"use server";
import { createClient } from "@/lib/server";
import { z } from "zod";
import { redirect } from "next/navigation";
const credentials = z.object({
  email: z.email(),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
  name: z.string().max(100).optional(),
});
export async function authenticate(
  mode: string,
  values: { email: string; password: string; name?: string },
) {
  const supabase = await createClient();
  const origin = process.env.APP_URL;
  if (!origin)
    return {
      error: "Authentication is not configured. Contact your administrator.",
    };
  if (mode === "forgot") {
    const parsed = z.email().safeParse(values.email);
    if (!parsed.success) return { error: "Enter a valid email address." };
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
    });
    return error
      ? { error: error.message }
      : {
          message:
            "If that account exists, a password reset link is on its way.",
        };
  }
  if (mode === "update") {
    if (values.password.length < 8)
      return { error: "Use at least 8 characters." };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        error: "Your link has expired. Request a new password reset email.",
      };
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (error) return { error: error.message };
    redirect("/dashboard");
  }
  const parsed = credentials.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (mode === "signup") {
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { display_name: values.name },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });
    return error
      ? { error: error.message }
      : {
          message:
            "Check your email to verify your account, then sign in to your workspace.",
        };
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: values.email,
    password: values.password,
  });
  if (error) return { error: error.message };
  redirect("/dashboard");
}
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}

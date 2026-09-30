import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./server";
export const getContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error || !profile)
    throw new Error(
      "Your workspace is not ready. The database migration must be installed before using the application.",
    );
  if (profile.archived) redirect("/auth/inactive");
  if (profile.role === "client" && profile.approval_status !== "approved")
    redirect("/auth/approval");
  const { data: workspaces, error: workspaceError } = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at");
  if (workspaceError) throw new Error(workspaceError.message);
  if (profile.role === "bidder" && !workspaces?.length)
    redirect("/auth/inactive");
  return { supabase, user, profile, workspaces: workspaces ?? [] };
});

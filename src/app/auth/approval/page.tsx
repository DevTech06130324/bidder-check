import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/server";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export default async function Approval() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile) throw new Error("Account unavailable");
  if (profile.archived) redirect("/auth/inactive");
  if (profile.role !== "client" || profile.approval_status === "approved")
    redirect("/dashboard");
  return (
    <div className="space-y-5">
      <p className="eyebrow">CLIENT REGISTRATION</p>
      <h1 className="text-2xl font-semibold">
        {profile.approval_status === "rejected"
          ? "Your registration needs attention"
          : "Your account is awaiting approval"}
      </h1>
      <p className="text-muted-foreground">
        {profile.approval_status === "rejected"
          ? profile.approval_reason
          : "An administrator will review your registration. Your workspace becomes available once approved."}
      </p>
      <p className="text-sm text-muted-foreground">
        Signed in as {profile.email}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href="/auth/approval">Check approval status</a>
        </Button>
        <Button asChild variant="outline">
          <Link href="/auth/update-password">Change password</Link>
        </Button>
        <form action={signOut}>
          <Button variant="ghost">Sign out</Button>
        </form>
      </div>
    </div>
  );
}

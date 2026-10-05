import { getContext } from "@/lib/auth";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, workspaces, supabase } = await getContext();
  const { count: unreadCount } = profile.role === "bidder" || profile.role === "admin"
    ? await supabase.from("inbox_notifications").select("id", { count: "exact", head: true }).is("read_at", null).is("resolved_at", null).eq("kind", profile.role === "admin" ? "client_signup" : "message")
    : { count: 0 };
  return (
    <Shell
      profile={profile}
      unreadCount={unreadCount ?? 0}
      workspace={
        profile.role === "admin"
          ? "Platform overview"
          : (workspaces[0]?.name ?? "My workspace")
      }
    >
      {children}
    </Shell>
  );
}

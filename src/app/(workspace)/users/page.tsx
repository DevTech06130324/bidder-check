import { getWorkspaceData } from "@/lib/data";
import { People } from "@/components/people";
import { redirect } from "next/navigation";
export default async function Users({ searchParams }: { searchParams: Promise<{ tab?: string; highlight?: string }> }) {
  const data = await getWorkspaceData();
  if (data.profile.role === "bidder") redirect("/dashboard");
  const params = await searchParams;
  return <People data={data} initialTab={params.tab === "pending" ? "pending" : "active"} highlightId={params.highlight} />;
}

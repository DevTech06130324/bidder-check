import { getWorkspaceData } from "@/lib/data";
import { People } from "@/components/people";
import { redirect } from "next/navigation";
export default async function Users() {
  const data = await getWorkspaceData();
  if (data.profile.role === "bidder") redirect("/dashboard");
  return <People data={data} />;
}

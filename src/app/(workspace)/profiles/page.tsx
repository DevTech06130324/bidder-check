import { redirect } from "next/navigation";
import { getWorkspaceData } from "@/lib/data";
import { CandidateProfileLibrary } from "@/components/profiles";

export default async function Profiles() {
  const data = await getWorkspaceData();
  if (data.profile.role === "bidder") redirect("/resumes");
  return <CandidateProfileLibrary data={data} />;
}

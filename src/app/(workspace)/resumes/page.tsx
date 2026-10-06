import { getWorkspaceData } from "@/lib/data";
import { ResumeLibrary } from "@/components/resumes";
export default async function Resumes() {
  return <ResumeLibrary data={await getWorkspaceData({ includeBidCounts: true })} />;
}

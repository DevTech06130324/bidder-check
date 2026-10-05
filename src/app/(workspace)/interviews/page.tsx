import { getWorkspaceData } from "@/lib/data";
import { InterviewReport } from "@/components/interviews";
export default async function Page() {
  return <InterviewReport data={await getWorkspaceData()} />;
}

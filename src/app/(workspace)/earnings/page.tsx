import { getWorkspaceData } from "@/lib/data";
import { Earnings } from "@/components/earnings";
export default async function Page() {
  return <Earnings data={await getWorkspaceData()} />;
}

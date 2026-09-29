import { getWorkspaceData } from "@/lib/data";
import { BidWorkspace } from "@/components/bids";
export default async function Bids() {
  return <BidWorkspace data={await getWorkspaceData()} />;
}

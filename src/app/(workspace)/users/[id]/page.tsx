import { getWorkspaceData } from "@/lib/data";
import { notFound } from "next/navigation";
import { BidderDetail } from "@/components/bidder-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getWorkspaceData();
  if (
    data.profile.role === "bidder" ||
    !data.bidders.some((b) => b.user_id === id)
  )
    notFound();
  return <BidderDetail data={data} id={id} />;
}

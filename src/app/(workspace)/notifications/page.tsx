import { getWorkspaceData } from "@/lib/data";
import { getClientMessages, getInboxNotifications } from "@/app/(workspace)/actions";
import { Notifications } from "@/components/notifications";
export default async function Page() {
  const data = await getWorkspaceData({ scope: "notifications" });
  const [inbox, messages] = await Promise.all([
    data.profile.role !== "client" ? getInboxNotifications() : Promise.resolve({ data: [] }),
    data.profile.role !== "bidder" ? getClientMessages() : Promise.resolve({ data: [] }),
  ]);
  return <Notifications data={data} initialInbox={inbox.data ?? []} initialMessages={messages.data ?? []} />;
}

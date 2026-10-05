import { getWorkspaceData } from "@/lib/data";
import { getClientMessages, getInboxNotifications } from "@/app/(workspace)/actions";
import { Notifications } from "@/components/notifications";
export default async function Page() {
  const data = await getWorkspaceData();
  const inbox = data.profile.role === "bidder" ? await getInboxNotifications() : { data: [] };
  const messages = data.profile.role !== "bidder" ? await getClientMessages() : { data: [] };
  return <Notifications data={data} initialInbox={inbox.data ?? []} initialMessages={messages.data ?? []} />;
}

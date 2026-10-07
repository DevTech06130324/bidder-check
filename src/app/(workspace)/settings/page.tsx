import { getWorkspaceData } from "@/lib/data";
import { Settings } from "@/components/settings";
export default async function Page() {
  return <Settings data={await getWorkspaceData({ scope: "settings" })} />;
}

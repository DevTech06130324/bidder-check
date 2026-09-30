import "server-only";
import { getContext } from "./auth";
import type { Row } from "./database.types";
export type WorkspaceData = {
  profile: Row<"profiles">;
  workspaces: Row<"workspaces">[];
  profiles: Row<"profiles">[];
  bidders: Row<"bidders">[];
  resumes: Row<"resumes">[];
  bids: Row<"bids">[];
  invitations: Row<"invitations">[];
};
export async function getWorkspaceData(): Promise<WorkspaceData> {
  const { supabase, profile, workspaces } = await getContext();
  async function all<
    T extends "profiles" | "bidders" | "resumes" | "bids" | "invitations",
  >(table: T): Promise<Row<T>[]> {
    const result: Row<T>[] = [];
    for (let start = 0; ; start += 1000) {
      let query = supabase
        .from(table)
        .select("*")
        .order(table === "bidders" ? "user_id" : "id")
        .range(start, start + 999);
      if (table === "bids") query = query.is("deleted_at", null);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      result.push(...(data as unknown as Row<T>[]));
      if (data.length < 1000) break;
    }
    return result;
  }
  const [profiles, bidders, resumes, bids, invitations] = await Promise.all([
    all("profiles"),
    all("bidders"),
    all("resumes"),
    all("bids"),
    profile.role === "bidder" ? Promise.resolve([]) : all("invitations"),
  ]);
  return { profile, workspaces, profiles, bidders, resumes, bids, invitations };
}

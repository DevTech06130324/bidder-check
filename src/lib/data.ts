import "server-only";
import { getContext } from "./auth";
import type { Row } from "./database.types";
export type WorkspaceData = {
  profile: Row<"profiles">;
  workspaces: Row<"workspaces">[];
  profiles: Row<"profiles">[];
  bidders: Row<"bidders">[];
  resumes: Row<"resumes">[];
  candidateProfiles: Row<"candidate_profiles">[];
  historicalAggregates: Row<"retained_bid_daily_aggregates">[];
  bids: Row<"bids">[];
  invitations: Row<"invitations">[];
};
export async function getWorkspaceData(): Promise<WorkspaceData> {
  const { supabase, profile, workspaces } = await getContext();
  async function all<
    T extends
      | "profiles"
      | "bidders"
      | "resumes"
      | "candidate_profiles"
      | "retained_bid_daily_aggregates"
      | "bids"
      | "invitations",
  >(table: T): Promise<Row<T>[]> {
    const result: Row<T>[] = [];
    for (let start = 0; ; start += 1000) {
      let query = supabase.from(table).select("*");
      if (table === "retained_bid_daily_aggregates") {
        query = query
          .order("report_day")
          .order("profile_id")
          .order("bidder_id")
          .order("resume_id")
          .order("metric");
      } else {
        query = query.order(table === "bidders" ? "user_id" : "id");
      }
      query = query.range(start, start + 999);
      if (table === "bids") query = query.is("deleted_at", null);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      result.push(...(data as unknown as Row<T>[]));
      if (data.length < 1000) break;
    }
    return result;
  }
  const [profiles, bidders, resumes, candidateProfiles, historicalAggregates, bids, invitations] =
    await Promise.all([
    all("profiles"),
    all("bidders"),
    all("resumes"),
    all("candidate_profiles"),
    all("retained_bid_daily_aggregates"),
    all("bids"),
    profile.role === "bidder" ? Promise.resolve([]) : all("invitations"),
    ]);
  return {
    profile,
    workspaces,
    profiles,
    bidders,
    resumes,
    candidateProfiles,
    historicalAggregates,
    bids,
    invitations,
  };
}

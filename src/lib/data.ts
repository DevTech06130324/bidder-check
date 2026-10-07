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
  bidCounts: Record<string, number>;
  invitations: Row<"invitations">[];
};
export async function getWorkspaceData(
  options: {
    includeBidCounts?: boolean;
    scope?: "full" | "settings" | "people" | "profiles" | "resumes" | "notifications" | "dashboard" | "bids" | "bidder-detail";
    bidderId?: string;
  } = {},
): Promise<WorkspaceData> {
  const { supabase, profile, workspaces } = await getContext();
  const scope = options.scope ?? "full";
  const needsProfiles = ["full", "people", "profiles", "resumes", "notifications", "dashboard", "bids", "bidder-detail"].includes(scope);
  const needsBidders = ["full", "people", "profiles", "resumes", "notifications", "dashboard", "bids", "bidder-detail"].includes(scope);
  const needsResumes = ["full", "profiles", "resumes", "bids", "bidder-detail"].includes(scope);
  const needsCandidateProfiles = ["full", "profiles", "resumes", "dashboard", "bids", "bidder-detail"].includes(scope);
  const needsInvitations = ["full", "people"].includes(scope) && profile.role !== "bidder";
  async function all<
    T extends
      | "profiles"
      | "bidders"
      | "resumes"
      | "candidate_profiles"
      | "invitations",
  >(table: T, filter?: { column: string; value: string }): Promise<Row<T>[]> {
    const result: Row<T>[] = [];
    for (let start = 0; ; start += 1000) {
      let query = supabase.from(table).select("*");
      if (filter) query = query.eq(filter.column as never, filter.value);
      query = query.order(table === "bidders" ? "user_id" : "id");
      query = query.range(start, start + 999);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      result.push(...(data as unknown as Row<T>[]));
      if (data.length < 1000) break;
    }
    return result;
  }
  const resumesPromise: Promise<Row<"resumes">[]> = needsResumes
    ? (async () => {
        let query = supabase.from("resumes").select("*").order("id");
        if (scope === "bidder-detail" && options.bidderId) query = query.eq("bidder_id", options.bidderId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data as Row<"resumes">[];
      })()
    : Promise.resolve([]);
  const candidateProfilesPromise: Promise<Row<"candidate_profiles">[]> =
    needsCandidateProfiles && scope === "bidder-detail" && options.bidderId
      ? resumesPromise.then(async (assignments) => {
          const ids = [...new Set(assignments.map((assignment) => assignment.profile_id).filter((id): id is string => !!id))];
          if (!ids.length) return [];
          const { data, error } = await supabase.from("candidate_profiles").select("*").in("id", ids).order("id");
          if (error) throw new Error(error.message);
          return data as Row<"candidate_profiles">[];
        })
      : needsCandidateProfiles ? all("candidate_profiles") : Promise.resolve([]);
  const [profiles, bidders, resumes, candidateProfiles, bidCountsResult, invitations] =
    await Promise.all([
    needsProfiles
      ? all("profiles", scope === "bidder-detail" && options.bidderId ? { column: "id", value: options.bidderId } : undefined)
      : Promise.resolve([]),
    needsBidders
      ? all("bidders", scope === "bidder-detail" && options.bidderId ? { column: "user_id", value: options.bidderId } : undefined)
      : Promise.resolve([]),
    resumesPromise,
    candidateProfilesPromise,
    options.includeBidCounts && scope === "bidder-detail" && options.bidderId && profile.role !== "bidder"
      ? supabase.rpc("resume_bid_counts_for_bidder", { p_bidder: options.bidderId })
      : options.includeBidCounts
        ? supabase.rpc("resume_bid_counts")
      : Promise.resolve({ data: {}, error: null }),
    needsInvitations ? all("invitations") : Promise.resolve([]),
    ]);
  if (bidCountsResult.error) throw new Error(bidCountsResult.error.message);
  const bidCounts = (bidCountsResult.data ?? {}) as Record<string, number>;
  return {
    profile,
    workspaces,
    profiles,
    bidders,
    resumes,
    candidateProfiles,
    historicalAggregates: [],
    bids: [],
    bidCounts,
    invitations,
  };
}

// Isolated component fixture server. No production authentication bypass.
const unavailable = async () => ({
  error: "Mutations are disabled in the visual test fixture.",
});
export const authenticate = unavailable,
  signOut = unavailable,
  saveBid = unavailable,
  saveResume = unavailable,
  archiveResume = unavailable,
  saveCandidateProfile = unavailable,
  saveCandidateProfileRules = unavailable,
  previewCandidateRetention = unavailable,
  archiveCandidateProfile = unavailable,
  archiveResumeAssignment = unavailable,
  updateBidder = unavailable,
  updateClient = unavailable,
  createBidder = unavailable,
  reviewClient = unavailable,
  resetManagedPassword = unavailable,
  createClientAccount = unavailable,
  unapplyBid = unavailable,
  reviewBidAction = unavailable,
  reviewBidsAction = unavailable,
  resubmitBidAction = unavailable,
  setBidInterviewAction = unavailable,
  saveSettings = unavailable,
  getFileUrl = unavailable;
export async function manualApplyBidsAction(input: { targets: { id: string; version: number }[] }) {
  if (!new URLSearchParams(window.location.search).has("manual-apply")) return unavailable();
  window.dispatchEvent(new CustomEvent("manual-apply", { detail: input.targets.length }));
  return { data: { applied: input.targets.length, unchanged: 0 } };
}
export async function getEarningsPerformance() {
  return { data: {
    totals: { count: 1, cents: 1000, resumes: 1, retainedCount: 0, trackedApplications: 1, trackedInterviews: 0, excludedInterviewCount: 0 },
    groups: [{ id: "resume-1", label: "ENG-01", sub: "Jamie Parker", count: 1, cents: 1000, applied: 1, interviews: 0 }],
  } };
}
export async function saveResumeAssignment(form: FormData) {
  if (!new URLSearchParams(location.search).has("assignment-upload")) return unavailable();
  window.dispatchEvent(new CustomEvent("assignment-save", { detail: String(form.get("id") ?? "") }));
  return { data: String(form.get("id") || crypto.randomUUID()) };
}
export async function prepareUpload(_kind: string, target: string) {
  if (new URLSearchParams(location.search).has("assignment-upload"))
    return { data: { id: target, storage_path: "fixture/resume.pdf" } };
  if (new URLSearchParams(location.search).has("paste-screenshot")) {
    document.documentElement.dataset.screenshotPrepared = target;
    window.dispatchEvent(new CustomEvent("screenshot-prepare", { detail: target }));
    return { data: { id: "fixture-screenshot-upload", storage_path: "fixture/screenshot.png" } };
  }
  return unavailable();
}
export async function finalizeUpload(id: string) {
  if (!new URLSearchParams(location.search).has("assignment-upload") && !new URLSearchParams(location.search).has("paste-screenshot")) return unavailable();
  if (new URLSearchParams(location.search).has("paste-screenshot")) document.documentElement.dataset.screenshotFinalized = id;
  return { data: id };
}
export const getBidHistory = async () => ({ data: [] });

let reads = 0;
export async function getBidRows(
  mode: string,
  from: string,
  to: string,
  trash: boolean,
  bidderId: string | undefined,
  query: import("@/lib/bid-list").BidListQuery,
) {
  if (
    new URLSearchParams(window.location.search).has("refresh-failure") &&
    reads++ > 0
  )
    return { error: "Refresh unavailable" };
  const { fixture } = await import("./sample-data");
  const { chicagoDateRange } = await import("@/lib/domain");
  try {
    const bounds = chicagoDateRange(mode, from, to);
    const filtered = fixture.bids.filter((b) => {
      const columns = Object.fromEntries(query.columnFilters.map((filter) => [filter.id, filter.value]));
      return Boolean(b.deleted_at) === trash &&
        (!bidderId || b.bidder_id === bidderId) &&
        (!bounds.from || b.found_at >= bounds.from) && (!bounds.to || b.found_at < bounds.to) &&
        (query.bidder === "all" || b.bidder_id === query.bidder) &&
        (query.resume === "all" || b.resume_id === query.resume) &&
        (query.source === "all" || b.source === query.source) &&
        (query.arrangement === "all" || b.arrangement === query.arrangement) &&
        (query.job === "all" || b.job_status === query.job) &&
        (query.status === "all" || (query.status === "pending_review" ? b.review_status === "pending" : b.applied === (query.status === "applied"))) &&
        `${b.company} ${b.role_name} ${b.url}`.toLowerCase().includes(query.search.toLowerCase()) &&
        Object.entries(columns).every(([field, value]) => {
          if (value && typeof value === "object") {
            const date = field === "applied_at" ? b.applied_at : b.found_at;
            if (!date) return (value as { presence?: string }).presence === "empty";
            const day = date.slice(0, 10);
            const range = value as { from?: string; to?: string; presence?: string };
            return range.presence !== "empty" && (!range.from || day >= range.from) && (!range.to || day <= range.to);
          }
          if (!value) return true;
          const actual = field === "applied" ? (b.applied ? "Applied" : "Unapplied") : field === "screenshot" ? (b.evidence_file_id ? "Has screenshot" : "No screenshot") : String(b[field as keyof typeof b] ?? "");
          return actual.toLowerCase().includes(String(value).toLowerCase());
        });
    });
    const sorted = [...filtered].sort((a, b) => {
      const sort = query.sorting[0];
      if (!sort) return b.found_at.localeCompare(a.found_at);
      const result = String(a[sort.id as keyof typeof a] ?? "").localeCompare(String(b[sort.id as keyof typeof b] ?? ""));
      return sort.desc ? -result : result;
    });
    return {
      data: { rows: sorted.slice(query.pageIndex * query.pageSize, (query.pageIndex + 1) * query.pageSize), total: sorted.length, sources: [...new Set(fixture.bids.map((b) => b.source).filter(Boolean))], statusCounts: { all: filtered.length, applied: filtered.filter((row)=>row.applied).length, unapplied: filtered.filter((row)=>!row.applied).length, pending_review: filtered.filter((row)=>row.review_status==="pending").length } },
    };
  } catch (e) {
    return { error: String(e) };
  }
}

// Only this isolated Vite fixture simulates writes. Production actions always use RLS/RPCs.
export async function updateBidCell(
  id: string,
  field: string,
  value: string,
  version: number,
) {
  const { fixture } = await import("./sample-data");
  const row = fixture.bids.find((b) => b.id === id)!;
  if (row.version !== version) return { data: { conflict: true, row } };
  if (["company", "role_name"].includes(field) && !value.trim())
    return { error: "Required; maximum 200 characters" };
  const updated = { ...row, [field]: value, version: version + 1 };
  fixture.bids = fixture.bids.map((b) => (b.id === id ? updated : b));
  return { data: { ok: true, row: updated } };
}
export async function checkBidImport(
  _resume: string,
  _date: string,
  rows: import("@/lib/sheets").ImportRow[],
) {
  if (new URLSearchParams(window.location.search).has("fresh-conflict")) {
    const count = Number(sessionStorage.getItem("fresh-import-validation") ?? "0") + 1;
    sessionStorage.setItem("fresh-import-validation", String(count));
    if (count >= 2) return { data: [{ row: 2, field: "url", code: "duplicate_url", message: "This profile already has an application for this job." }] };
  }
  if (new URLSearchParams(window.location.search).has("block-import")) {
    return {
      data: rows.map((_, index) => ({
        row: index + 1,
        field: "url",
        code: "profile_restriction",
        message: "This job URL is blocked by a profile restriction.",
      })),
    };
  }
  const { validateImportRows } = await import("@/lib/sheets");
  return { data: validateImportRows(rows) };
}
export async function importBids() {
  if (new URLSearchParams(location.search).has("lost-import")) return { error: "fetch failed", uncertain: true };
  return unavailable();
}
export async function reconcileBidTargets(targets: { id: string; version: number }[], trash: boolean) {
  const { fixture } = await import("./sample-data");
  return { data: targets.filter((target) => fixture.bids.some((row) => row.id === target.id && Boolean(row.deleted_at) === trash)).map((target) => target.id) };
}
export async function importReviewedBids(_resume: string, date: string, rows: import("@/lib/sheets").ImportRow[], sourceRows: number[]) {
  if (new URLSearchParams(location.search).has("lost-import")) return { error: "fetch failed", uncertain: true };
  document.documentElement.dataset.lastImportCount = String(rows.length);
  return { data: { ids: rows.map(() => crypto.randomUUID()), sourceRows, skipped: [], date, bidder: "bidder-0", resume: "resume-0" } };
}

export async function getDashboardPerformance({ from, to }: { from: string; to: string }) {
  const { fixture } = await import("./sample-data");
  const days: { date: string; found: number; foundApplied: number; applied: number; earningsCents: number; earningsCount: number }[] = [];
  for (let date = from; date <= to; ) {
    days.push({ date, found: 0, foundApplied: 0, applied: 0, earningsCents: 0, earningsCount: 0 });
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  if (days.length) Object.assign(days[days.length - 1], { found: fixture.bids.length, foundApplied: fixture.bids.filter((row) => row.applied).length, applied: fixture.bids.filter((row) => row.applied).length, earningsCents: 1000, earningsCount: 1 });
  return { data: {
    daily: days,
    totals: { found: fixture.bids.length, foundApplied: fixture.bids.filter((row) => row.applied).length, appliedActivity: fixture.bids.filter((row) => row.applied).length, earningsCents: 1000, earningsCount: 1, trackedApplications: 1, trackedInterviews: 0 },
    review: { pending: fixture.bids.filter((row) => row.review_status === "pending").length, approved_unapplied: 0, rejected: 0 },
    sources: [{ label: "LinkedIn", value: fixture.bids.length }],
    groups: [{ key: "profile-0", label: "ENG-01", applied: 1, interviews: 0, conversion: 0 }],
  } };
}

export async function trashBid(id: string, deleted: boolean) {
  const { fixture } = await import("./sample-data");
  fixture.bids = fixture.bids.map((b) =>
    b.id === id
      ? { ...b, deleted_at: deleted ? new Date().toISOString() : null }
      : b,
  );
  return { data: undefined };
}

export async function bulkBidState(
  targets: { id: string; version: number }[],
  deleted: boolean,
) {
  const { fixture } = await import("./sample-data");
  const ids = new Set(targets.map((t) => t.id));
  fixture.bids = fixture.bids.map((b) =>
    ids.has(b.id)
      ? {
          ...b,
          deleted_at: deleted ? new Date().toISOString() : null,
          version: b.version + 1,
        }
      : b,
  );
  return { data: targets.length };
}
export async function prepareBidPurge(
  mode: string,
  targets: { id: string; version: number }[],
) {
  const { fixture } = await import("./sample-data");
  return {
    data: {
      id: "fixture-operation",
      count:
        mode === "all"
          ? fixture.bids.filter((b) => b.deleted_at).length
          : targets.length,
      scope: "Selected trashed bids",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    },
  };
}
export const confirmBidPurge = unavailable,
  getPurgeStatus = unavailable;
export const getInboxNotifications = async () => ({ data: [] });
export const getClientMessages = async () => ({ data: [] });
export const markInboxNotificationAction = unavailable,
  saveClientMessageAction = unavailable,
  setClientMessageStatusAction = unavailable,
  savePushSubscriptionAction = unavailable,
  deletePushSubscriptionAction = unavailable;
// `?purge-notice` simulates a removed screenshot whose verification becomes due in 4 seconds.
const loadedAt = Date.now();
let verified = false;
const purgeFixture = () => ({
  id: "fixture-operation",
  scope: "Selected trashed bids",
  deletedCount: 15,
  pendingFiles: verified ? 0 : 1,
  awaitingRemovalFiles: 0,
  verifyingFiles: verified ? 0 : 1,
  processingFiles: 0,
  failedFiles: 0,
  nextAttemptAt: verified ? null : new Date(loadedAt + 4000).toISOString(),
  serverTime: new Date().toISOString(),
});
export const recentBidPurges = async () => ({
  data:
    !verified && new URLSearchParams(window.location.search).has("purge-notice")
      ? [purgeFixture()]
      : [],
});
export async function retryPurgeCleanup() {
  if (Date.now() < loadedAt + 4000)
    return { data: { status: purgeFixture(), outcome: "waiting" } };
  verified = true;
  return { data: { status: purgeFixture(), outcome: "processed" } };
}

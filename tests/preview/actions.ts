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
    return {
      data: fixture.bids.filter(
        (b) =>
          Boolean(b.deleted_at) === trash &&
          (!bounds.from || b.found_at >= bounds.from) &&
          (!bounds.to || b.found_at < bounds.to),
      ),
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

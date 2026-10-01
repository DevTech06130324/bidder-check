// Isolated component fixture server. No production authentication bypass.
const unavailable = async () => ({
  error: "Mutations are disabled in the visual test fixture.",
});
export const authenticate = unavailable,
  signOut = unavailable,
  saveBid = unavailable,
  saveResume = unavailable,
  archiveResume = unavailable,
  updateBidder = unavailable,
  updateClient = unavailable,
  createBidder = unavailable,
  reviewClient = unavailable,
  resetManagedPassword = unavailable,
  createClientAccount = unavailable,
  unapplyBid = unavailable,
  saveSettings = unavailable,
  prepareUpload = unavailable,
  finalizeUpload = unavailable,
  getFileUrl = unavailable;
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
  const { validateImportRows } = await import("@/lib/sheets");
  return { data: validateImportRows(rows) };
}
export const importBids = unavailable;

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
export const recentBidPurges = async () => ({ data: [] });

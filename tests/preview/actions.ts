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
  trashBid = unavailable,
  unapplyBid = unavailable,
  saveSettings = unavailable,
  prepareUpload = unavailable,
  finalizeUpload = unavailable,
  getFileUrl = unavailable;
export const getBidHistory = async () => ({ data: [] });

export async function getBidRows(
  mode: string,
  from: string,
  to: string,
  trash: boolean,
) {
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

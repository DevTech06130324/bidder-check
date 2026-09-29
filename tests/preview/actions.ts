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
  inviteBidder = unavailable,
  applyBid = unavailable,
  unapplyBid = unavailable,
  saveSettings = unavailable,
  prepareUpload = unavailable,
  finalizeUpload = unavailable,
  getFileUrl = unavailable;
export const getBidHistory = async () => ({ data: [] });

export type BidTarget = { id: string; version: number };
export type PurgeSnapshot = {
  id: string;
  count: number;
  scope: string;
  expiresAt: string;
};
export type PurgeStatus = {
  id: string;
  scope: string;
  deletedCount: number;
  pendingFiles: number;
  verifyingFiles: number;
  failedFiles: number;
};

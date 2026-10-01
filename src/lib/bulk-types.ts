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
  /** Removed once; awaiting the delayed final verification. */
  verifyingFiles: number;
  /** Not yet removed even once. */
  awaitingRemovalFiles: number;
  /** Currently held by a worker. */
  processingFiles: number;
  /** Unleased tasks whose last attempt failed. */
  failedFiles: number;
  /** Earliest time an unleased task may be attempted; null when none is idle. */
  nextAttemptAt: string | null;
  serverTime: string;
};
export type CleanupOutcome = "waiting" | "processing" | "processed" | "failed";
export type PurgeResult = { status: PurgeStatus; outcome: CleanupOutcome };

import type { PurgeStatus } from "./bulk-types";

export type PurgePhase =
  "removing" | "scheduled" | "verifying" | "failed" | "complete";

const at = (value: string | null) => (value ? Date.parse(value) : NaN);

/** Milliseconds until the next attempt, measured on the server's clock. */
export function msUntilNextAttempt(status: PurgeStatus, serverNow: number) {
  const next = at(status.nextAttemptAt);
  return Number.isNaN(next) ? 0 : Math.max(0, next - serverNow);
}

/** `serverNow` is the server clock estimate (client clock plus measured offset). */
export function purgePhase(status: PurgeStatus, serverNow: number): PurgePhase {
  if (!status.pendingFiles) return "complete";
  if (status.failedFiles) return "failed";
  if (status.awaitingRemovalFiles) return "removing";
  if (status.processingFiles) return "verifying";
  return msUntilNextAttempt(status, serverNow) > 0 ? "scheduled" : "verifying";
}

/** Retry is for eligible work or retryable failures, never an intentional wait or live lease. */
export function canRetryPurge(status: PurgeStatus, serverNow: number) {
  if (!status.pendingFiles || status.processingFiles >= status.pendingFiles)
    return false;
  return status.failedFiles > 0 || msUntilNextAttempt(status, serverNow) === 0;
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function formatDelay(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function purgeMessage(status: PurgeStatus, serverNow: number) {
  const phase = purgePhase(status, serverNow);
  const files = plural(status.pendingFiles, "file");
  switch (phase) {
    case "complete":
      return "Cleanup complete";
    case "failed":
      return `Cleanup failed — retry available (${files} left)`;
    case "scheduled":
      return `Screenshots removed — final verification scheduled in ${formatDelay(msUntilNextAttempt(status, serverNow))} (${files})`;
    case "verifying":
      return `Verifying cleanup (${plural(status.verifyingFiles, "file")})`;
    case "removing":
      return `Removing screenshots (${plural(status.awaitingRemovalFiles || status.pendingFiles, "file")})`;
  }
}

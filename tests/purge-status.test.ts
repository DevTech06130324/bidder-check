import { expect, it } from "vitest";
import type { PurgeStatus } from "@/lib/bulk-types";
import {
  canRetryPurge,
  formatDelay,
  purgeMessage,
  purgePhase,
} from "@/lib/purge-status";

const NOW = Date.parse("2026-09-30T20:05:00Z");
const status = (patch: Partial<PurgeStatus> = {}): PurgeStatus => ({
  id: "op",
  scope: "Selected trashed bids",
  deletedCount: 15,
  pendingFiles: 1,
  awaitingRemovalFiles: 0,
  verifyingFiles: 1,
  processingFiles: 0,
  failedFiles: 0,
  nextAttemptAt: "2026-09-30T20:09:13Z",
  serverTime: "2026-09-30T20:05:00Z",
  ...patch,
});

it("describes an already-removed screenshot as awaiting verification, not remaining", () => {
  const message = purgeMessage(status(), NOW);
  expect(message).toBe(
    "Screenshots removed — final verification scheduled in 4m 13s (1 file)",
  );
  expect(message).not.toMatch(/remaining/i);
});

it("walks through every phase with correct wording", () => {
  expect(purgePhase(status({ pendingFiles: 0, verifyingFiles: 0 }), NOW)).toBe(
    "complete",
  );
  expect(
    purgeMessage(
      status({ pendingFiles: 2, awaitingRemovalFiles: 2, verifyingFiles: 0 }),
      NOW,
    ),
  ).toBe("Removing screenshots (2 files)");
  expect(purgeMessage(status({ nextAttemptAt: null }), NOW)).toBe(
    "Verifying cleanup (1 file)",
  );
  expect(
    purgeMessage(status({ processingFiles: 1, nextAttemptAt: null }), NOW),
  ).toBe("Verifying cleanup (1 file)");
  expect(purgeMessage(status({ failedFiles: 1 }), NOW)).toBe(
    "Cleanup failed — retry available (1 file left)",
  );
  expect(purgeMessage(status({ pendingFiles: 0 }), NOW)).toBe(
    "Cleanup complete",
  );
});

it("turns a due verification into 'Verifying cleanup' as the clock passes", () => {
  expect(purgePhase(status(), NOW)).toBe("scheduled");
  expect(purgePhase(status(), Date.parse("2026-09-30T20:09:13Z"))).toBe(
    "verifying",
  );
});

it("disables retry while verification waits or a worker holds the files", () => {
  expect(canRetryPurge(status(), NOW)).toBe(false);
  expect(canRetryPurge(status({ processingFiles: 1 }), NOW)).toBe(false);
  expect(canRetryPurge(status({ pendingFiles: 0 }), NOW)).toBe(false);
});

it("enables retry for eligible work and retryable failures", () => {
  expect(canRetryPurge(status(), Date.parse("2026-09-30T20:09:14Z"))).toBe(
    true,
  );
  expect(canRetryPurge(status({ failedFiles: 1 }), NOW)).toBe(true);
  expect(
    canRetryPurge(
      status({ pendingFiles: 2, processingFiles: 1, failedFiles: 1 }),
      NOW,
    ),
  ).toBe(true);
});

it("formats countdowns", () => {
  expect(formatDelay(500)).toBe("1s");
  expect(formatDelay(59_000)).toBe("59s");
  expect(formatDelay(61_000)).toBe("1m 01s");
});

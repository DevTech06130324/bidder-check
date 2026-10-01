import { beforeEach, expect, it, vi } from "vitest";
import type { PurgeStatus } from "@/lib/bulk-types";

const { rpc, worker } = vi.hoisted(() => ({ rpc: vi.fn(), worker: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getContext: async () => ({ supabase: { rpc } }),
}));
vi.mock("@/lib/storage-cleanup", () => ({ runStorageCleanup: worker }));
import {
  confirmBidPurge,
  getPurgeStatus,
  retryPurgeCleanup,
} from "@/app/(workspace)/actions";

const OP = "7b0c5f5e-5d0e-4b53-8f0e-5f2d7a1a9c11";
const status = (patch: Partial<PurgeStatus> = {}): PurgeStatus => ({
  id: OP,
  scope: "Selected trashed bids",
  deletedCount: 1,
  pendingFiles: 1,
  awaitingRemovalFiles: 0,
  verifyingFiles: 1,
  processingFiles: 0,
  failedFiles: 0,
  nextAttemptAt: "2026-09-30T20:10:00Z",
  serverTime: "2026-09-30T20:05:00Z",
  ...patch,
});
const respond = (...statuses: PurgeStatus[]) => {
  let n = 0;
  rpc.mockImplementation(async (name: string) => {
    if (name === "bid_purge_status" || name === "retry_bid_cleanup")
      return {
        data: statuses[Math.min(n++, statuses.length - 1)],
        error: null,
      };
    return { data: null, error: null };
  });
};
beforeEach(() => {
  rpc.mockReset();
  worker.mockReset();
});

it("reports 'waiting' without running the worker before the verification delay", async () => {
  respond(status(), status());
  const result = await retryPurgeCleanup(OP);
  expect(result.data?.outcome).toBe("waiting");
  expect(worker).not.toHaveBeenCalled();
});

it("reports 'processing' while another worker holds every file", async () => {
  respond(status({ processingFiles: 1 }), status({ processingFiles: 1 }));
  expect((await retryPurgeCleanup(OP)).data?.outcome).toBe("processing");
  expect(worker).not.toHaveBeenCalled();
});

it("runs eligible work and reports 'processed'", async () => {
  const due = status({ nextAttemptAt: "2026-09-30T20:04:00Z" });
  respond(due, status({ pendingFiles: 0, verifyingFiles: 0 }));
  worker.mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0 });
  const result = await retryPurgeCleanup(OP);
  expect(worker).toHaveBeenCalledWith(OP);
  expect(result.data?.outcome).toBe("processed");
  expect(result.data?.status.pendingFiles).toBe(0);
});

it("surfaces a Storage failure as 'failed' instead of swallowing it", async () => {
  respond(status({ failedFiles: 1 }), status({ failedFiles: 1 }));
  worker.mockResolvedValue({ attempted: 1, succeeded: 0, failed: 1 });
  expect((await retryPurgeCleanup(OP)).data?.outcome).toBe("failed");
});

it("surfaces a worker exception before task claiming as 'failed'", async () => {
  respond(status({ failedFiles: 1 }), status({ failedFiles: 1 }));
  worker.mockRejectedValue(new Error("Screenshot cleanup is pending."));
  const result = await retryPurgeCleanup(OP);
  expect(result.error).toBeUndefined();
  expect(result.data?.outcome).toBe("failed");
});

it("reports 'processing' when another worker wins the claim race", async () => {
  respond(
    status({ nextAttemptAt: "2026-09-30T20:04:00Z" }),
    status({ processingFiles: 1 }),
  );
  worker.mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0 });
  expect((await retryPurgeCleanup(OP)).data?.outcome).toBe("processing");
});

it("keeps the application deletion successful when cleanup fails", async () => {
  respond(status({ failedFiles: 1 }));
  worker.mockRejectedValue(new Error("Storage offline"));
  const result = await confirmBidPurge(OP, "DELETE");
  expect(result.error).toBeUndefined();
  expect(result.data?.outcome).toBe("failed");
  expect(rpc).toHaveBeenCalledWith("confirm_bid_purge", { p_operation: OP });
});

it("never runs the worker when only reading status", async () => {
  respond(status());
  expect((await getPurgeStatus(OP)).data?.id).toBe(OP);
  expect(rpc).not.toHaveBeenCalledWith("retry_bid_cleanup", expect.anything());
  expect(worker).not.toHaveBeenCalled();
});

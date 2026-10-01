import { beforeEach, expect, it, vi } from "vitest";
const { rpc, remove, worker } = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  worker: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({
  adminClient: () => ({ rpc, storage: { from: () => ({ remove }) } }),
}));
import { runStorageCleanup } from "@/lib/storage-cleanup";
beforeEach(() => {
  rpc.mockReset();
  remove.mockReset();
  worker.mockReset();
});
it("removes objects through Storage and records failures for a later retry", async () => {
  rpc
    .mockResolvedValueOnce({
      data: [{ id: "task", lease_id: "lease", storage_path: "private/path" }],
    })
    .mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: { message: "Storage offline" } });
  expect(await runStorageCleanup("operation")).toEqual({ attempted: 1 });
  expect(remove).toHaveBeenCalledWith(["private/path"]);
  expect(rpc).toHaveBeenLastCalledWith("finish_storage_cleanup", {
    p_task: "task",
    p_lease: "lease",
    p_success: false,
  });
});
it("does not mark a rejected Storage request successful", async () => {
  rpc
    .mockResolvedValueOnce({
      data: [{ id: "task", lease_id: "lease", storage_path: "private/path" }],
    })
    .mockResolvedValue({ error: null });
  remove.mockRejectedValue(new Error("Network timeout"));
  await runStorageCleanup();
  expect(rpc).toHaveBeenLastCalledWith("finish_storage_cleanup", {
    p_task: "task",
    p_lease: "lease",
    p_success: false,
  });
});
it("passes successful removal to the database verification state", async () => {
  rpc
    .mockResolvedValueOnce({
      data: [{ id: "task", lease_id: "lease", storage_path: "private/path" }],
    })
    .mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  await runStorageCleanup();
  expect(rpc).toHaveBeenLastCalledWith("finish_storage_cleanup", {
    p_task: "task",
    p_lease: "lease",
    p_success: true,
  });
});

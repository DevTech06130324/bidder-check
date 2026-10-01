import { afterEach, expect, it, vi } from "vitest";
const { worker } = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock("@/lib/storage-cleanup", () => ({ runStorageCleanup: worker }));
import { GET } from "@/app/api/cron/storage-cleanup/route";
afterEach(() => {
  vi.unstubAllEnvs();
  worker.mockReset();
});
it("requires the exact server secret and fails closed when unconfigured", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect(
    (await GET(new Request("https://app/api/cron/storage-cleanup"))).status,
  ).toBe(401);
  vi.stubEnv("CRON_SECRET", "a-secret");
  expect(
    (
      await GET(
        new Request("https://app/api/cron/storage-cleanup", {
          headers: { authorization: "Bearer wrong" },
        }),
      )
    ).status,
  ).toBe(401);
  expect(worker).not.toHaveBeenCalled();
  worker.mockResolvedValue({ attempted: 2, succeeded: 2, failed: 0 });
  expect(
    (
      await GET(
        new Request("https://app/api/cron/storage-cleanup", {
          headers: { authorization: "Bearer a-secret" },
        }),
      )
    ).status,
  ).toBe(200);
  expect(worker).toHaveBeenCalledOnce();
});
it("drains multiple batches within the function limit and reports a pending retry on failure", async () => {
  vi.stubEnv("CRON_SECRET", "a-secret");
  const call = () =>
    GET(
      new Request("https://app/api/cron/storage-cleanup", {
        headers: { authorization: "Bearer a-secret" },
      }),
    );
  worker.mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0 });
  await call();
  expect(worker).toHaveBeenCalledWith(undefined, {
    maxBatches: expect.any(Number),
    deadlineMs: expect.any(Number),
  });
  expect(worker.mock.calls[0][1].maxBatches).toBeGreaterThan(1);
  worker.mockRejectedValue(new Error("db down"));
  const failed = await call();
  expect(failed.status).toBe(503);
  expect(JSON.stringify(await failed.json())).not.toMatch(/db down/);
});

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
  worker.mockResolvedValue({ attempted: 2 });
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

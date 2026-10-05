import { beforeEach, expect, it, vi } from "vitest";
const { rpc, revalidate } = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/storage-cleanup", () => ({ runStorageCleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getContext: async () => ({ supabase: { rpc } }) }));
import { importBids } from "@/app/(workspace)/actions";
const resume = "00000000-0000-4000-8000-000000000001";
const request = "00000000-0000-4000-8000-000000000002";
const rows = [{ company: "Acme", role_name: "Engineer", url: "https://example.com/job", source: "", arrangement: "remote", job_status: "open" }];
beforeEach(() => { rpc.mockReset(); revalidate.mockReset(); });
it("preserves uncertain import outcomes when the RPC response is lost", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: fetch failed" } });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ uncertain: true });
});
it("preserves uncertain import outcomes when revalidation fails after commit", async () => {
  rpc.mockResolvedValue({ data: { ids: [resume] }, error: null });
  revalidate.mockImplementation(() => { throw new Error("revalidation interrupted"); });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ uncertain: true });
});
it("allows editing after a definite database rejection", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Assignment unavailable" } });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ error: "Assignment unavailable", uncertain: false });
});

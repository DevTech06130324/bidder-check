import { beforeEach, expect, it, vi } from "vitest";
const { rpc, revalidate } = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/storage-cleanup", () => ({ runStorageCleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getContext: async () => ({ supabase: { rpc } }) }));
import { checkBidImport, importBids, importReviewedBids } from "@/app/(workspace)/actions";
const resume = "00000000-0000-4000-8000-000000000001";
const request = "00000000-0000-4000-8000-000000000002";
const rows = [{ company: "Acme", role_name: "Engineer", url: "https://example.com/job", source: "", arrangement: "remote", job_status: "open" }];
beforeEach(() => { rpc.mockReset(); revalidate.mockReset(); });
it("preserves uncertain import outcomes when the RPC response is lost", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: fetch failed" } });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ uncertain: true });
});
it("returns committed import results without refreshing the entire workspace", async () => {
  rpc.mockResolvedValue({ data: { ids: [resume] }, error: null });
  revalidate.mockImplementation(() => { throw new Error("revalidation interrupted"); });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ data: { ids: [resume] } });
  expect(revalidate).not.toHaveBeenCalled();
});
it("allows editing after a definite database rejection", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Assignment unavailable" } });
  expect(await importBids(resume, "2026-10-05", rows, request)).toMatchObject({ error: "Assignment unavailable", uncertain: false });
});
it("sends malformed URLs to row validation so other import rows can continue", async () => {
  rpc.mockResolvedValue({ data: [{ row: 1, field: "url", code: "invalid_value", message: "Enter a valid URL" }], error: null });
  const invalid = [{ ...rows[0], url: "not a URL" }];
  expect(await checkBidImport(resume, "2026-10-05", invalid)).toMatchObject({ data: [{ row: 1, field: "url" }] });
  expect(rpc).toHaveBeenCalledWith("validate_bid_import", expect.objectContaining({ p_rows: invalid }));
});
it("sends only the reviewed allowed subset with its original source row numbers", async () => {
  rpc.mockResolvedValue({ data: { ids: [resume], sourceRows: [4], skipped: [], date: "2026-10-05", bidder: resume, resume }, error: null });
  expect(await importReviewedBids(resume, "2026-10-05", rows, [4], request)).toMatchObject({ data: { sourceRows: [4] } });
  expect(rpc).toHaveBeenCalledWith("import_bids_reviewed", expect.objectContaining({ p_rows: rows, p_source_rows: [4] }));
});
it("turns a PostgreSQL statement timeout into a retryable no-commit message", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
  expect(await importReviewedBids(resume, "2026-10-05", rows, [1], request)).toMatchObject({
    error: "The database import timed out. No bids were committed; retry this batch. If the timeout repeats, split it into smaller batches.",
  });
});

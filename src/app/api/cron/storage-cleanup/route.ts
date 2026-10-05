import { timingSafeEqual } from "node:crypto";
import { runStorageCleanup } from "@/lib/storage-cleanup";
import { adminClient } from "@/lib/admin";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let phase = "admin-client";
  try {
    const admin = adminClient(true);
    phase = "retention";
    const { data: retention, error: retentionError } = await admin.rpc(
      "process_candidate_retention",
      { p_limit: 1000 },
    );
    if (retentionError) throw new Error(`Retention pass failed: ${retentionError.message}`);
    // Drain backlogs inside the function limit; leases make overlapping calls safe.
    phase = "storage-cleanup";
    const storageCleanup = await runStorageCleanup(undefined, {
        maxBatches: 20,
        deadlineMs: 40_000,
      });
    phase = "cleanup-status";
    const { data: cleanupStatus, error: statusError } = await admin.rpc(
      "retention_cleanup_status",
    );
    if (statusError) throw new Error(`Cleanup status unavailable: ${statusError.message}`);
    return Response.json(
      { retention, storageCleanup, cleanupStatus },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[storage-cleanup] request failed", {
      phase,
      error: error instanceof Error ? error.message : "Unknown failure",
    });
    return Response.json(
      { error: "Cleanup pending; retry scheduled" },
      { status: 503 },
    );
  }
}

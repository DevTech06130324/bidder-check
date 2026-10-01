import { timingSafeEqual } from "node:crypto";
import { runStorageCleanup } from "@/lib/storage-cleanup";
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
  try {
    // Drain backlogs inside the function limit; leases make overlapping calls safe.
    return Response.json(
      await runStorageCleanup(undefined, {
        maxBatches: 20,
        deadlineMs: 40_000,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Cleanup pending; retry scheduled" },
      { status: 503 },
    );
  }
}

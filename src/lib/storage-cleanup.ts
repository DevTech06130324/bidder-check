import "server-only";
import { adminClient } from "./admin";

const BATCH = 50;
export type CleanupResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};
type Options = { maxBatches?: number; deadlineMs?: number };

/**
 * Bounded passes (default one). Failed calls leave durable tasks available after their
 * lease. Logs carry counts only, never file paths or Storage error text.
 */
export async function runStorageCleanup(
  operation?: string,
  { maxBatches = 1, deadlineMs }: Options = {},
): Promise<CleanupResult> {
  const admin = adminClient(true);
  const stopAt = deadlineMs === undefined ? Infinity : Date.now() + deadlineMs;
  const total: CleanupResult = { attempted: 0, succeeded: 0, failed: 0 };
  for (let batch = 0; batch < maxBatches && Date.now() < stopAt; batch++) {
    const { data: tasks, error } = await admin.rpc("claim_storage_cleanup", {
      p_operation: operation ?? null,
      p_limit: BATCH,
    });
    if (error) {
      console.error("[storage-cleanup] claim failed", { ...total });
      throw new Error("Screenshot cleanup is pending. Please retry.");
    }
    if (!tasks?.length) break;
    let success = false;
    try {
      const result = await admin.storage
        .from("private-files")
        .remove(tasks.map((t) => t.storage_path!));
      success = !result.error;
    } catch {
      /* Persist failure; never report physical removal as successful. */
    }
    // Finish in parallel within a bounded claim; no file paths appear in app responses.
    const finished = await Promise.all(
      tasks.map(async (task) => {
        const { error } = await admin.rpc("finish_storage_cleanup", {
          p_task: task.id,
          p_lease: task.lease_id!,
          p_success: success,
        });
        return !error;
      }),
    );
    total.attempted += tasks.length;
    total[success ? "succeeded" : "failed"] += tasks.length;
    if (finished.includes(false)) {
      console.error("[storage-cleanup] finish failed", { ...total });
      throw new Error("Screenshot cleanup is pending. Please retry.");
    }
    if (!success)
      console.error("[storage-cleanup] removal failed", { ...total });
    if (tasks.length < BATCH) break;
  }
  if (total.attempted)
    console.info("[storage-cleanup] pass complete", { ...total });
  return total;
}

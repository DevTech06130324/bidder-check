import "server-only";
import { adminClient } from "./admin";

/** One bounded pass. Failed calls leave durable tasks available after their lease. */
export async function runStorageCleanup(operation?: string) {
  const admin = adminClient(true);
  const { data: tasks, error } = await admin.rpc("claim_storage_cleanup", {
    p_operation: operation ?? null,
    p_limit: 50,
  });
  if (error) throw new Error("Screenshot cleanup is pending. Please retry.");
  if (!tasks?.length) return { attempted: 0 };
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
  await Promise.all(
    tasks.map(async (task) => {
      const { error } = await admin.rpc("finish_storage_cleanup", {
        p_task: task.id,
        p_lease: task.lease_id!,
        p_success: success,
      });
      if (error)
        throw new Error("Screenshot cleanup is pending. Please retry.");
    }),
  );
  return { attempted: tasks.length };
}

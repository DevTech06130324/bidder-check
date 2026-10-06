// Remove one interrupted hosted-smoke run from the isolated staging project.
// Set SMOKE_PREFIX to the UUID prefix printed by the synthetic smoke accounts.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const stagingUrl = "https://kdmvludtvhuuewmhurpw.supabase.co";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, stagingUrl, "Staging only");
const prefix = process.env.SMOKE_PREFIX;
assert.match(
  prefix ?? "",
  /^smoke-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Provide the exact UUID prefix for one synthetic hosted-smoke run",
);

const admin = createClient(stagingUrl, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ok = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const chunks = (items, size = 100) => {
  const result = [];
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size));
  return result;
};
async function allRows(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const page = ok(await makeQuery().range(start, start + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const profiles = ok(
  await admin.from("profiles").select("id,email").ilike("email", `${prefix}-%`),
);
assert.ok(profiles.length > 0, "No synthetic profiles match that prefix");
const userIds = profiles.map((profile) => profile.id);
const workspaces = ok(
  await admin.from("workspaces").select("id").in("owner_id", userIds),
);
const workspaceIds = workspaces.map((workspace) => workspace.id);
let deletedBidCount = 0;

if (workspaceIds.length) {
  const files = await allRows(
    () => admin
      .from("files")
      .select("storage_path")
      .in("workspace_id", workspaceIds)
      .order("id"),
  );
  for (const group of chunks(files.map((file) => file.storage_path)))
    ok(await admin.storage.from("private-files").remove(group));

  const bids = await allRows(
    () => admin
      .from("bids")
      .select("id")
      .in("workspace_id", workspaceIds)
      .order("id"),
  );
  const bidIds = bids.map((bid) => bid.id);
  deletedBidCount = bidIds.length;
  for (const group of chunks(bidIds, 200))
    ok(await admin.from("bid_events").delete().in("bid_id", group));

  ok(
    await admin
      .from("bids")
      .update({ applied: false, evidence_file_id: null })
      .in("workspace_id", workspaceIds),
  );
  ok(
    await admin
      .from("resumes")
      .update({ file_id: null })
      .in("workspace_id", workspaceIds),
  );
  for (const table of ["files", "bids", "resumes", "invitations", "bidders"])
    ok(await admin.from(table).delete().in("workspace_id", workspaceIds));
  ok(await admin.from("workspaces").delete().in("id", workspaceIds));
}

ok(
  await admin
    .from("application_library_reset_audits")
    .delete()
    .in("actor_id", userIds),
);
const operations = ok(
  await admin
    .from("bid_purge_operations")
    .select("id")
    .in("actor_id", userIds),
);
const operationIds = operations.map((operation) => operation.id);
if (operationIds.length) {
  const tasks = ok(
    await admin
      .from("storage_cleanup_tasks")
      .select("storage_path")
      .in("operation_id", operationIds),
  );
  for (const group of chunks(
    tasks.map((task) => task.storage_path).filter(Boolean),
  ))
    ok(await admin.storage.from("private-files").remove(group));
  ok(
    await admin
      .from("storage_cleanup_tasks")
      .delete()
      .in("operation_id", operationIds),
  );
  ok(
    await admin
      .from("bid_purge_operations")
      .delete()
      .in("id", operationIds),
  );
}
ok(await admin.from("bid_import_receipts").delete().in("actor_id", userIds));
ok(await admin.from("client_provisions").delete().in("created_by", userIds));
ok(await admin.from("account_events").delete().in("account_id", userIds));
ok(
  await admin
    .from("profiles")
    .update({ reviewed_by: null })
    .in("id", userIds),
);
ok(await admin.from("profiles").delete().in("id", userIds));
for (const userId of userIds) ok(await admin.auth.admin.deleteUser(userId));

console.log(
  `Removed ${profiles.length} synthetic profiles, ${workspaceIds.length} workspaces, ${deletedBidCount} applications, and their associated files.`,
);

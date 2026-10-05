import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const projects = {
  staging: "kdmvludtvhuuewmhurpw",
  production: "aizorlyfggwbewetnwqm",
};
const args = new Set(process.argv.slice(2));
const value = (name) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};
const environment = value("environment");
assert.ok(environment in projects, "Pass --environment=staging or --environment=production");
const inventoryOnly = args.has("--inventory");
const resetting = args.has("--reset");
const verifyCleanup = args.has("--verify-cleanup");
assert.equal(
  [inventoryOnly, resetting, verifyCleanup].filter(Boolean).length,
  1,
  "Choose exactly one of --inventory, --reset, or --verify-cleanup",
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const projectRef = new URL(url ?? "https://invalid").hostname.split(".")[0];
assert.equal(projectRef, projects[environment], `Refusing to run against a non-${environment} project`);
const secret = process.env.SUPABASE_SECRET_KEY;
assert.ok(secret, "SUPABASE_SECRET_KEY is required");
const appOrigin =
  value("app-url") ??
  process.env.CUTOVER_APP_URL ??
  (environment === "production" ? "https://bidder-check.vercel.app" : process.env.APP_URL);
if (resetting || verifyCleanup) {
  assert.ok(appOrigin, "Provide --app-url or CUTOVER_APP_URL for the deployed app");
  assert.equal(new URL(appOrigin).protocol, "https:", "Cleanup must use a deployed HTTPS app origin");
}
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ok = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function selectAll(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = ok(await makeQuery().range(offset, offset + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function listWorkspaceObjects(workspaceIds) {
  const paths = [];
  async function list(folder) {
    let offset = 0;
    for (;;) {
      const entries = ok(
        await admin.storage.from("private-files").list(folder, {
          limit: 100,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      );
      for (const entry of entries) {
        const fullPath = `${folder}/${entry.name}`;
        if (entry.id) paths.push(fullPath);
        else await list(fullPath);
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
  }
  for (const workspaceId of workspaceIds) await list(workspaceId);
  return paths.sort();
}

async function snapshot() {
  const workspaces = await selectAll(() =>
    admin.from("workspaces").select("id,owner_id,name,timezone,created_at").order("id"),
  );
  const workspaceIds = workspaces.map((row) => row.id);
  const [profiles, bidders, invitations, fileRows, inventory, storagePaths] = await Promise.all([
    selectAll(() =>
      admin
        .from("profiles")
        .select("id,email,display_name,role,archived,approval_status,approval_reason")
        .order("id"),
    ),
    selectAll(() =>
      admin
        .from("bidders")
        .select("user_id,workspace_id,default_rate_cents,archived")
        .order("user_id"),
    ),
    selectAll(() =>
      admin
        .from("invitations")
        .select("id,workspace_id,email,display_name,default_rate_cents,expires_at,accepted_at")
        .order("id"),
    ),
    workspaceIds.length
      ? selectAll(() =>
          admin
            .from("files")
            .select("id,workspace_id,storage_path,kind,finalized")
            .in("workspace_id", workspaceIds)
            .order("id"),
        )
      : Promise.resolve([]),
    workspaceIds.length
      ? admin.rpc("application_library_inventory", { p_workspaces: workspaceIds })
      : Promise.resolve({ data: null, error: null }),
    listWorkspaceObjects(workspaceIds),
  ]);
  const rows = {
    profiles,
    bidders,
    invitations,
  };

  const databaseInventory = ok(inventory) ?? {
    workspaceCount: 0,
    profileCount: 0,
    assignmentCount: 0,
    bidCount: 0,
    fileCount: 0,
    pendingUploadCount: 0,
    eventCount: 0,
    fingerprint: hash([]),
  };
  const objects = storagePaths;
  const linkedPathSet = new Set(fileRows.map((file) => file.storage_path));
  const accountFingerprint = hash({ workspaces, ...rows });
  const fingerprint = hash({
    database: databaseInventory.fingerprint,
    accountFingerprint,
    storagePaths: objects,
  });
  return {
    workspaces,
    workspaceIds,
    rows,
    fileRows,
    objects,
    untrackedStorageObjectCount: objects.filter((path) => !linkedPathSet.has(path)).length,
    cleanupPaths: [...new Set([...fileRows.map((file) => file.storage_path), ...objects])],
    databaseInventory,
    accountFingerprint,
    fingerprint,
  };
}

function printInventory(state) {
  console.log(
    JSON.stringify(
      {
        environment,
        workspaceCount: state.databaseInventory.workspaceCount,
        accountCount: state.rows.profiles.length,
        bidderMembershipCount: state.rows.bidders.length,
        invitationCount: state.rows.invitations.length,
        profileCount: state.databaseInventory.profileCount,
        assignmentCount: state.databaseInventory.assignmentCount,
        bidCount: state.databaseInventory.bidCount,
        fileRecordCount: state.databaseInventory.fileCount,
        pendingUploadCount: state.databaseInventory.pendingUploadCount,
        bidEventCount: state.databaseInventory.eventCount,
        storageObjectCount: state.objects.length,
        untrackedStorageObjectCount: state.untrackedStorageObjectCount,
        fingerprint: state.fingerprint,
      },
      null,
      2,
    ),
  );
}

async function verifyPendingCleanup() {
  assert.equal(environment, "production", "Cleanup verification is restricted to production");
  assert.ok(process.env.CRON_SECRET, "CRON_SECRET is required to verify Storage cleanup");
  const initial = await selectAll(() =>
    admin
      .from("storage_cleanup_tasks")
      .select("id,storage_path")
      .is("completed_at", null)
      .order("id"),
  );
  const ids = initial.map((task) => task.id);
  const paths = initial.map((task) => task.storage_path).filter(Boolean);
  const deadline = Date.now() + 10 * 60_000;
  while (ids.length && Date.now() < deadline) {
    const pending = await selectAll(() =>
      admin
        .from("storage_cleanup_tasks")
        .select("id,next_attempt_at")
        .in("id", ids)
        .is("completed_at", null)
        .order("id"),
    );
    if (!pending.length) break;
    const response = await fetch(`${appOrigin.replace(/\/$/, "")}/api/cron/storage-cleanup`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    assert.equal(response.status, 200, `Cleanup endpoint returned ${response.status}: ${body}`);
    const nextAttempt = Math.min(...pending.map((task) => new Date(task.next_attempt_at).getTime()));
    await sleep(Math.max(1000, Math.min(15_000, nextAttempt - Date.now() + 1000)));
  }
  if (ids.length) {
    const pending = await selectAll(() =>
      admin
        .from("storage_cleanup_tasks")
        .select("id")
        .in("id", ids)
        .is("completed_at", null)
        .order("id"),
    );
    assert.equal(pending.length, 0, "Physical Storage cleanup is still pending");
  }
  for (const path of paths) {
    const { data, error } = await admin.storage.from("private-files").download(path);
    assert.equal(data, null, "A queued Storage object remains");
    assert.ok(error, "Storage should report a deleted object as missing");
    assert.ok(
      (String(error.statusCode) === "404" || error.status === 404) &&
        /object not found|not found|no such object/i.test(error.message),
      `Expected Storage 404; received ${error.statusCode ?? error.status ?? "no status"}`,
    );
  }
  console.log(JSON.stringify({ result: "cleanup_verified", tasksCompleted: ids.length, storageObjectsAbsent: paths.length }));
}

if (inventoryOnly) {
  printInventory(await snapshot());
  process.exit(0);
}
if (verifyCleanup) {
  await verifyPendingCleanup();
  process.exit(0);
}

assert.equal(environment, "production", "Destructive reset is permitted only through the production cutover flow");
assert.equal(
  value("confirm-reset"),
  "RESET ALL APPLICATION LIBRARY DATA",
  "Pass --confirm-reset=RESET ALL APPLICATION LIBRARY DATA to confirm the destructive reset",
);
assert.ok(value("expected-fingerprint"), "Pass the fingerprint from the reviewed production inventory");
assert.ok(process.env.CRON_SECRET, "CRON_SECRET is required to verify physical Storage cleanup");
const expected = Buffer.from(value("expected-fingerprint"));
const state = await snapshot();
printInventory(state);
assert.ok(state.workspaces.length > 0, "No workspaces found; refusing the production reset");
assert.equal(
  expected.length,
  state.fingerprint.length,
  "Production data or Storage objects changed since inventory; take a fresh inventory",
);
assert.ok(
  timingSafeEqual(expected, Buffer.from(state.fingerprint)),
  "Production data or Storage objects changed since inventory; take a fresh inventory",
);
assert.ok(
  state.databaseInventory.profileCount + state.databaseInventory.assignmentCount + state.databaseInventory.bidCount + state.databaseInventory.fileCount + state.objects.length > 0,
  "The production library is already empty; refusing an unnecessary reset",
);

const adminActor = ok(
  await admin
    .from("profiles")
    .select("id")
    .eq("email", "david.chan.mdev@gmail.com")
    .eq("role", "admin")
    .eq("archived", false)
    .single(),
);
ok(await admin.rpc("set_application_library_cutover", { p_active: true }));
let reset;
try {
  const lockedState = await snapshot();
  assert.equal(
    lockedState.fingerprint,
    state.fingerprint,
    "Production data changed before the cutover lock; disable write pause and take a fresh inventory",
  );
  reset = ok(
    await admin.rpc("reset_application_library", {
      p_workspaces: state.workspaceIds,
      p_expected_fingerprint: state.databaseInventory.fingerprint,
      p_actor: adminActor.id,
    }),
  );
  assert.equal(reset.deleted, true);

  // The SQL reset queues every database-tracked object. Queue any older orphan
  // object under an explicitly selected workspace as well, without touching any
  // path outside those workspace prefixes.
  const linkedPaths = new Set(state.fileRows.map((file) => file.storage_path));
  const orphanPaths = state.objects.filter((path) => !linkedPaths.has(path));
  if (orphanPaths.length) {
    const existing = ok(
      await admin
        .from("storage_cleanup_tasks")
        .select("storage_path")
        .in("storage_path", orphanPaths)
        .is("completed_at", null),
    );
    const queued = new Set(existing.map((task) => task.storage_path));
    const missing = orphanPaths.filter((path) => !queued.has(path));
    if (missing.length)
      ok(
        await admin
          .from("storage_cleanup_tasks")
          .insert(missing.map((storage_path) => ({ operation_id: null, storage_path }))),
      );
  }

  const afterReset = await snapshot();
  assert.deepEqual(afterReset.workspaces, state.workspaces, "Workspace settings or membership owners changed");
  assert.equal(afterReset.accountFingerprint, state.accountFingerprint, "Accounts, memberships, invitations, or account settings changed");
  for (const field of ["profileCount", "assignmentCount", "bidCount", "fileCount", "eventCount"])
    assert.equal(afterReset.databaseInventory[field], 0, `${field} remains after reset`);
} finally {
  // Resume normal writes as soon as the database is empty and verified. The
  // delayed Storage worker only touches the old, snapshotted object paths.
  ok(await admin.rpc("set_application_library_cutover", { p_active: false }));
}

const cleanupTasks = ok(
    await admin
      .from("storage_cleanup_tasks")
      .select("id,completed_at")
    .in("storage_path", state.cleanupPaths),
);
const taskIds = [...new Set(cleanupTasks.map((task) => task.id))];
const deadline = Date.now() + 10 * 60_000;
while (taskIds.length && Date.now() < deadline) {
  const pending = ok(
    await admin
      .from("storage_cleanup_tasks")
      .select("id,next_attempt_at")
      .in("id", taskIds)
      .is("completed_at", null),
  );
  if (!pending.length) break;
  const response = await fetch(`${appOrigin.replace(/\/$/, "")}/api/cron/storage-cleanup`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(response.status, 200, "Production cleanup endpoint failed; database reset is complete, but file cleanup remains pending");
  const nextAttempt = Math.min(...pending.map((task) => new Date(task.next_attempt_at).getTime()));
  await sleep(Math.max(1000, Math.min(15_000, nextAttempt - Date.now() + 1000)));
}
if (taskIds.length) {
  const pending = ok(
    await admin
      .from("storage_cleanup_tasks")
      .select("id")
      .in("id", taskIds)
      .is("completed_at", null),
  );
  assert.equal(pending.length, 0, "Database reset completed; screenshot/resume Storage cleanup is still pending");
}

for (const path of state.objects) {
  const { data, error } = await admin.storage.from("private-files").download(path);
  assert.equal(data, null, "A workspace Storage object remains after cleanup");
  assert.ok(error, "Storage should report the deleted object as missing");
  assert.ok(
    (String(error.statusCode) === "404" || error.status === 404) &&
      /object not found|not found|no such object/i.test(error.message),
    `Expected Storage 404; received ${error.statusCode ?? error.status ?? "no status"}`,
  );
}
console.log(
  JSON.stringify({
    result: "reset_complete",
    workspacesPreserved: state.workspaces.length,
    accountsAndMembershipsPreserved: true,
    profilesRemoved: reset.profileCount,
    assignmentsRemoved: reset.assignmentCount,
    bidsRemoved: reset.bidCount,
    fileRecordsRemoved: reset.fileCount,
    storageObjectsVerifiedAbsent: state.objects.length,
  }),
);

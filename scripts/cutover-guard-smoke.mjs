// Run only against the isolated staging Supabase project.
// .\node_modules\node\bin\node.exe --env-file=.env.staging scripts/cutover-guard-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://kdmvludtvhuuewmhurpw.supabase.co", "Staging only");
const service = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ok = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const suffix = randomUUID();
const password = `Cutover-${randomUUID()}!`;
const accounts = [];
let resetActor;
let active = false;

async function makeAccount(label) {
  const created = ok(
    await service.auth.admin.createUser({
      email: `cutover-${label}-${suffix}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Cutover ${label}` },
    }),
  );
  accounts.push(created.user.id);
  const { data: profile, error } = await service
    .from("profiles")
    .update({ role: "client", approval_status: "approved" })
    .eq("id", created.user.id)
    .select("id")
    .single();
  if (error) throw error;
  const workspace = ok(
    await service.from("workspaces").select("id").eq("owner_id", profile.id).single(),
  );
  return { ...created.user, workspace: workspace.id };
}

async function inventory(workspace) {
  return ok(
    await service.rpc("application_library_inventory", {
      p_workspaces: [workspace],
    }),
  );
}

try {
  const admin = await makeAccount("admin");
  await service.from("profiles").update({ role: "admin" }).eq("id", admin.id);
  resetActor = admin.id;
  const profile = ok(
    await service
      .from("candidate_profiles")
      .insert({ workspace_id: admin.workspace, identifier: `CUT-${suffix.slice(0, 8)}`, candidate_name: "Synthetic Reset Profile" })
      .select("id")
      .single(),
  );
  const first = await inventory(admin.workspace);
  assert.equal(first.profileCount, 1);
  ok(
    await service
      .from("candidate_profiles")
      .update({ instructions: "edited after inventory" })
      .eq("id", profile.id),
  );
  const changedProfileReset = await service.rpc("reset_application_library", {
    p_workspaces: [admin.workspace],
    p_expected_fingerprint: first.fingerprint,
    p_actor: admin.id,
  });
  assert.match(changedProfileReset.error?.message ?? "", /changed after inventory/i);

  const second = await inventory(admin.workspace);
  const survivor = await makeAccount("survivor");
  const changedWorkspaceReset = await service.rpc("reset_application_library", {
    p_workspaces: [admin.workspace],
    p_expected_fingerprint: second.fingerprint,
    p_actor: admin.id,
  });
  assert.match(changedWorkspaceReset.error?.message ?? "", /changed after inventory/i);

  const confirmed = await inventory(admin.workspace);
  ok(await service.rpc("set_application_library_cutover", { p_active: true }));
  active = true;
  const session = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ok(await session.auth.signInWithPassword({ email: survivor.email, password }));
  const blockedWrite = await session.rpc("save_candidate_profile", {
    p_id: null,
    p_workspace: survivor.workspace,
    p_identifier: `BLOCKED-${suffix.slice(0, 8)}`,
    p_name: "Must Remain Blocked",
    p_address: "",
    p_links: "",
    p_instructions: "",
  });
  assert.match(blockedWrite.error?.message ?? "", /temporarily paused/i);

  const reset = ok(
    await service.rpc("reset_application_library", {
      p_workspaces: [admin.workspace],
      p_expected_fingerprint: confirmed.fingerprint,
      p_actor: admin.id,
    }),
  );
  assert.equal(reset.deleted, true);
  assert.equal(
    ok(await service.from("candidate_profiles").select("id").eq("workspace_id", admin.workspace)).length,
    0,
  );
  assert.equal(
    ok(await service.from("workspaces").select("id").eq("id", admin.workspace)).length,
    1,
  );
  assert.equal(
    ok(await service.from("workspaces").select("id").eq("id", survivor.workspace)).length,
    1,
  );
  ok(await service.rpc("set_application_library_cutover", { p_active: false }));
  active = false;
  console.log("PASS stale profile/workspace inventories rejected; paused writes blocked; guarded reset preserved both accounts/workspaces");
} finally {
  if (active) await service.rpc("set_application_library_cutover", { p_active: false });
  if (resetActor)
    await service.from("application_library_reset_audits").delete().eq("actor_id", resetActor);
  if (accounts.length)
    await service.from("workspaces").delete().in("owner_id", accounts);
  for (const id of accounts) await service.auth.admin.deleteUser(id);
  console.log("Synthetic cutover guard accounts cleaned up.");
}

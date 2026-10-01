// Staging-only acceptance for automatic screenshot cleanup. Takes ~6-8 minutes.
// SMOKE_VERCEL_BYPASS=<automation bypass> node --env-file=.env.staging scripts/cleanup-schedule-acceptance.mjs
// No browser is open and nothing calls the worker or edits task timestamps: only the
// Supabase Cron trigger and the real five-minute verification delay can finish the work.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://kdmvludtvhuuewmhurpw.supabase.co", "Staging only");
const origin =
  process.env.SMOKE_APP_URL ?? "https://bidder-check-staging.vercel.app";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const bidder = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const FILES = 61; // more than one 50-file batch
const password = `Smoke-${randomUUID()}!`;
const prefix = `cleanup-${randomUUID()}`;
const users = [];
let workspace;
const ok = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const log = (message) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimal valid PNG (1x1).
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const exists = async (path) =>
  !(await admin.storage.from("private-files").download(path)).error;

try {
  const headers = process.env.SMOKE_VERCEL_BYPASS
    ? { "x-vercel-protection-bypass": process.env.SMOKE_VERCEL_BYPASS }
    : {};
  const unauthorized = await fetch(`${origin}/api/cron/storage-cleanup`, {
    headers: { ...headers, authorization: "Bearer wrong" },
    redirect: "manual",
  });
  assert.equal(unauthorized.status, 401, "unauthorized callers are rejected");
  log("PASS unauthorized cleanup request returns 401");

  const clientEmail = `${prefix}-client@example.com`;
  const owner = ok(
    await admin.auth.admin.createUser({
      email: clientEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Cleanup Client" },
    }),
  ).user;
  users.push(owner.id);
  ok(
    await admin
      .from("profiles")
      .update({ approval_status: "approved" })
      .eq("id", owner.id),
  );
  workspace = ok(
    await admin
      .from("workspaces")
      .select("id")
      .eq("owner_id", owner.id)
      .single(),
  ).id;
  ok(await client.auth.signInWithPassword({ email: clientEmail, password }));
  const bidderEmail = `${prefix}-bidder@example.com`;
  const reservation = ok(
    await client.rpc("invite_bidder", {
      p_workspace: workspace,
      p_email: bidderEmail,
      p_name: "Cleanup Bidder",
      p_rate: 100,
    }),
  );
  ok(
    await admin.auth.admin.createUser({
      id: reservation,
      email: bidderEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Cleanup Bidder" },
    }),
  );
  users.push(reservation);
  ok(await bidder.auth.signInWithPassword({ email: bidderEmail, password }));
  const resume = ok(
    await client.rpc("save_resume", {
      p_id: null,
      p_workspace: workspace,
      p_bidder: reservation,
      p_identifier: "CLEANUP-01",
      p_name: "Cleanup Candidate",
      p_email: "candidate@example.com",
      p_phone: "",
      p_address: "",
      p_links: "",
      p_instructions: "",
      p_rate: 100,
    }),
  );
  const paths = [];
  for (let i = 0; i < FILES; i++) {
    const bid = ok(
      await bidder.rpc("save_bid", {
        p_id: null,
        p_resume: resume,
        p_company: "Cleanup Co",
        p_role: `Role ${i}`,
        p_url: `https://example.com/cleanup/${prefix}/${i}`,
        p_source: "",
        p_arrangement: "remote",
        p_status: "open",
      }),
    );
    const file = ok(
      await bidder.rpc("prepare_file", {
        p_kind: "screenshot",
        p_target: bid,
        p_name: "proof.png",
        p_mime: "image/png",
        p_size: png.length,
      }),
    );
    const path = ok(
      await admin.from("files").select("storage_path").eq("id", file).single(),
    ).storage_path;
    ok(
      await bidder.storage
        .from("private-files")
        .upload(path, png, { contentType: "image/png" }),
    );
    paths.push(path);
    ok(await bidder.rpc("trash_bid", { p_bid: bid, p_deleted: true }));
  }
  log(`created ${FILES} trashed applications with screenshots`);

  const op = ok(
    await client.rpc("prepare_bid_purge", {
      p_mode: "all",
      p_targets: [],
      p_bidder: reservation,
    }),
  );
  assert.equal(op.count, FILES);
  ok(await client.rpc("confirm_bid_purge", { p_operation: op.id }));
  const deletedAt = Date.now();
  log(`purged ${FILES} applications; waiting for the scheduler only`);

  const tasks = async () =>
    ok(
      await admin
        .from("storage_cleanup_tasks")
        .select(
          "storage_path,first_removed_at,completed_at,next_attempt_at,attempts",
        )
        .eq("operation_id", op.id),
    );
  let removedAt = 0,
    reuploaded = false;
  for (;;) {
    const rows = await tasks();
    assert.equal(rows.length, FILES);
    const removed = rows.filter((t) => t.first_removed_at).length;
    const done = rows.filter((t) => t.completed_at).length;
    log(`removed once ${removed}/${FILES}, verified ${done}/${FILES}`);
    if (!removedAt && removed === FILES) {
      removedAt = Date.now();
      for (const path of paths)
        assert.ok(!(await exists(path)), "objects removed on first pass");
      // Simulate a slow upload landing after the initial removal.
      ok(
        await admin.storage
          .from("private-files")
          .upload(paths[0], png, { contentType: "image/png", upsert: true }),
      );
      reuploaded = true;
      log("PASS all objects removed by the scheduler; late upload simulated");
    }
    if (done === FILES) break;
    assert.ok(Date.now() - deletedAt < 12 * 60_000, "cleanup finished in time");
    await sleep(15_000);
  }
  const finishedAt = Date.now();
  assert.ok(reuploaded);
  assert.ok(
    removedAt - deletedAt < 3 * 60_000,
    "first removal within ~2 minutes",
  );
  assert.ok(
    finishedAt - removedAt >= 4 * 60_000,
    "verification waited for the delay",
  );
  for (const path of paths)
    assert.ok(!(await exists(path)), "late upload and all objects are gone");
  const status = ok(
    await client.rpc("bid_purge_status", { p_operation: op.id }),
  );
  assert.equal(status.pendingFiles, 0);
  log(
    `PASS ${FILES} files removed in ${Math.round((removedAt - deletedAt) / 1000)}s and verified ${Math.round((finishedAt - deletedAt) / 1000)}s after deletion, with no browser or manual worker call`,
  );
} finally {
  if (users.length) {
    const ops = ok(
      await admin
        .from("bid_purge_operations")
        .select("id")
        .in("actor_id", users),
    ).map((o) => o.id);
    if (ops.length) {
      const leftover = ok(
        await admin
          .from("storage_cleanup_tasks")
          .select("storage_path")
          .in("operation_id", ops),
      )
        .map((t) => t.storage_path)
        .filter(Boolean);
      if (leftover.length)
        ok(await admin.storage.from("private-files").remove(leftover));
      ok(
        await admin
          .from("storage_cleanup_tasks")
          .delete()
          .in("operation_id", ops),
      );
      ok(await admin.from("bid_purge_operations").delete().in("id", ops));
    }
  }
  if (workspace) {
    const files = ok(
      await admin
        .from("files")
        .select("storage_path")
        .eq("workspace_id", workspace),
    ).map((f) => f.storage_path);
    if (files.length)
      ok(await admin.storage.from("private-files").remove(files));
    const bids = ok(
      await admin.from("bids").select("id").eq("workspace_id", workspace),
    );
    if (bids.length)
      ok(
        await admin
          .from("bid_events")
          .delete()
          .in(
            "bid_id",
            bids.map((b) => b.id),
          ),
      );
    ok(
      await admin
        .from("bids")
        .update({ applied: false, evidence_file_id: null })
        .eq("workspace_id", workspace),
    );
    for (const table of ["files", "bids", "resumes", "invitations", "bidders"])
      ok(await admin.from(table).delete().eq("workspace_id", workspace));
    ok(await admin.from("workspaces").delete().eq("id", workspace));
  }
  if (users.length) {
    ok(await admin.from("account_events").delete().in("account_id", users));
    ok(
      await admin
        .from("profiles")
        .update({ reviewed_by: null })
        .in("id", users),
    );
    ok(await admin.from("profiles").delete().in("id", users));
    for (const id of users) ok(await admin.auth.admin.deleteUser(id));
  }
  log("synthetic staging accounts, applications and files cleaned up");
}

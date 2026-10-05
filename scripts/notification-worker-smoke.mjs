// Staging-only acceptance: real scheduled worker HTTP, not direct process RPC.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://kdmvludtvhuuewmhurpw.supabase.co", "Staging only");
const origin = process.env.SMOKE_APP_URL;
assert.ok(origin?.startsWith("https://bidder-check-"));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const bidder = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const ids = [], workspaces = [];
const prefix = `worker-smoke-${randomUUID()}`, password = `Test-${randomUUID()}!`;
const ok = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const headers = { "x-vercel-protection-bypass": process.env.SMOKE_VERCEL_BYPASS };
try {
  const ownerEmail = `${prefix}-owner@example.test`;
  const owner = ok(await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true })).user;
  ids.push(owner.id);
  ok(await admin.from("profiles").update({ approval_status: "approved" }).eq("id", owner.id));
  const workspace = ok(await admin.from("workspaces").select("id").eq("owner_id", owner.id).single()).id;
  workspaces.push(workspace);
  ok(await client.auth.signInWithPassword({ email: ownerEmail, password }));
  const bidderEmail = `${prefix}-bidder@example.test`;
  const reservation = ok(await client.rpc("invite_bidder", { p_workspace: workspace, p_email: bidderEmail, p_name: "Worker test bidder", p_rate: 100 }));
  const recipient = ok(await admin.auth.admin.createUser({ id: reservation, email: bidderEmail, password, email_confirm: true })).user;
  ids.push(recipient.id);
  ok(await bidder.auth.signInWithPassword({ email: bidderEmail, password }));
  const title = `${prefix} scheduled message`;
  ok(await client.rpc("save_client_message", {
    p_id: null, p_workspace: workspace, p_title: title, p_body: "Synthetic scheduled delivery verification.",
    p_mode: "selected", p_recipients: [recipient.id], p_kind: "once",
    p_scheduled_at: new Date(Date.now() - 60000).toISOString(), p_local_time: null, p_weekdays: [], p_draft: false,
  }));
  const denied = await fetch(`${origin}/api/cron/notifications`, { method: "POST", redirect: "manual", headers });
  assert.equal(denied.status, 401);
  const response = await fetch(`${origin}/api/cron/notifications`, { method: "POST", redirect: "manual", headers: { ...headers, authorization: `Bearer ${process.env.NOTIFICATION_WORKER_SECRET}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const result = await response.json();
  assert.equal(typeof result.schedule.occurrences, "number");
  assert.equal(result.pushConfigured, true);
  assert.equal(ok(await bidder.from("inbox_notifications").select("id").eq("title", title)).length, 1);
  const retry = await fetch(`${origin}/api/cron/notifications`, { method: "POST", redirect: "manual", headers: { ...headers, authorization: `Bearer ${process.env.NOTIFICATION_WORKER_SECRET}` } });
  assert.equal(retry.status, 200);
  assert.equal(ok(await bidder.from("inbox_notifications").select("id").eq("title", title)).length, 1);
  for (const path of ["/push-worker.js", "/manifest.webmanifest"]) {
    const asset = await fetch(`${origin}${path}`, { redirect: "manual", headers });
    assert.equal(asset.status, 200);
    assert.doesNotMatch(asset.headers.get("content-type") ?? "", /text\/html/);
  }
  console.log("PASS staging: bearer-only worker publishes one scheduled inbox message, retries do not duplicate it, PWA assets are public");
} finally {
  if (workspaces.length) {
    ok(await admin.from("invitations").delete().in("workspace_id", workspaces));
    ok(await admin.from("bidders").delete().in("workspace_id", workspaces));
    ok(await admin.from("workspaces").delete().in("id", workspaces));
  }
  if (ids.length) { ok(await admin.from("profiles").delete().in("id", ids)); for (const id of ids) ok(await admin.auth.admin.deleteUser(id)); }
  console.log("Synthetic staging worker records removed.");
}

// Post-release verification. Creates and removes exactly one synthetic pending
// client; never edits the designated administrator or existing customer data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://aizorlyfggwbewetnwqm.supabase.co");
const origin = "https://bidder-check.vercel.app";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const email = `release-check-${randomUUID()}@example.com`;
const password = `Release-${randomUUID()}!`;
function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
let browser;
try {
  const designated = ok(
    await admin
      .from("profiles")
      .select("role,archived")
      .eq("email", "david.chan.mdev@gmail.com")
      .single(),
  );
  assert.equal(designated.role, "admin");
  assert.equal(designated.archived, false);
  const signup = ok(
    await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: "Release verification",
          role: "admin",
          approval_status: "approved",
        },
      },
    }),
  );
  assert.ok(signup.session, "Immediate sign-in must remain enabled");
  const profile = ok(
    await client
      .from("profiles")
      .select("role,approval_status")
      .eq("id", signup.user.id)
      .single(),
  );
  assert.deepEqual(profile, { role: "client", approval_status: "pending" });
  assert.deepEqual(ok(await client.from("workspaces").select("id")), []);
  assert.deepEqual(ok(await client.from("bids").select("id")), []);
  for (const [name, args] of [
    [
      "bulk_bid_state",
      { p_targets: [{ id: randomUUID(), version: 0 }], p_deleted: true },
    ],
    ["prepare_bid_purge", { p_mode: "all", p_targets: [], p_bidder: null }],
    ["confirm_bid_purge", { p_operation: randomUUID() }],
    ["retry_bid_cleanup", { p_operation: randomUUID() }],
    [
      "update_bid_cell",
      {
        p_bid: randomUUID(),
        p_field: "company",
        p_value: "Denied",
        p_version: 0,
      },
    ],
    [
      "validate_bid_import",
      { p_resume: randomUUID(), p_date: "2025-10-01", p_rows: [] },
    ],
    [
      "import_bids",
      {
        p_resume: randomUUID(),
        p_date: "2025-10-01",
        p_rows: [],
        p_request: randomUUID(),
      },
    ],
  ]) {
    const result = await client.rpc(name, args);
    assert.match(result.error?.message ?? "", /Access denied/i);
  }
  assert.deepEqual(
    ok(await client.from("bid_import_receipts").select("request_id")),
    [],
  );
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${origin}/auth/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\/approval/);
  await expect(
    page.getByRole("heading", { name: "Your account is awaiting approval" }),
  ).toBeVisible();
  await page.goto(`${origin}/bids`);
  await expect(page).toHaveURL(/\/auth\/approval/);
  await page
    .getByRole("link", { name: "Change password", exact: true })
    .click();
  await page
    .getByLabel("New password", { exact: true })
    .fill(`${password}changed`);
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\/approval/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  console.log(
    "PASS production: designated admin active; signup metadata cannot grant roles/approval; pending access denied including spreadsheet and bulk/purge RPCs; approval routing, password change and sign-out work",
  );
} finally {
  await browser?.close();
  const rows = ok(
    await admin.from("profiles").select("id,email").eq("email", email),
  );
  for (const row of rows) {
    assert.equal(row.email, email);
    ok(await admin.from("workspaces").delete().eq("owner_id", row.id));
    ok(await admin.from("profiles").delete().eq("id", row.id));
    ok(await admin.auth.admin.deleteUser(row.id));
  }
  console.log("Synthetic production verification account cleaned up.");
}

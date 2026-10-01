// Run only against the dedicated staging project. No email is sent by this test.
// node --env-file=.env.staging scripts/hosted-smoke.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 45000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://kdmvludtvhuuewmhurpw.supabase.co", "Staging only");
const origin = process.env.SMOKE_APP_URL ?? "http://localhost:3002";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    // Retry connection failures for reads and password sign-in only. Never
    // retry creation, uploads, or mutations whose response may have been lost.
    fetch: async (input, init) => {
      const retryable =
        !init?.method ||
        init.method === "GET" ||
        String(input).includes("/auth/v1/token?grant_type=password");
      for (let attempt = 0; ; attempt++) {
        try {
          return await fetch(input, init);
        } catch (error) {
          if (!retryable || attempt >= 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    },
  },
};
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(url, key, options);
const bidder = createClient(url, key, options);
const other = createClient(url, key, options);
const administrator = createClient(url, key, options);
const password = `Smoke-${randomUUID()}!`;
const prefix = `smoke-${randomUUID()}`;
const users = [],
  workspaces = [],
  checks = [];
let browser;
function pass(message) {
  checks.push(message);
  console.log(`PASS ${message}`);
}
function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function seedClient(label) {
  const email = `${prefix}-${label}@example.com`;
  const data = ok(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Smoke ${label}` },
    }),
  );
  users.push(data.user.id);
  return { email, id: data.user.id };
}
async function readBid(id) {
  return ok(await admin.from("bids").select("*").eq("id", id).single());
}
async function openBid(page) {
  await page.goto(`${origin}/bids`);
  await page
    .getByRole("button", {
      name: "View Engineer at Smoke Company",
      exact: true,
    })
    .click();
}
async function uploadProof(page, buffer, success = true) {
  await page
    .getByRole("dialog")
    .getByLabel("Choose screenshot", { exact: true })
    .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer });
  if (success)
    await expect(
      page.getByText("Screenshot uploaded", { exact: true }),
    ).toBeVisible({ timeout: 45000 });
}

try {
  browser = await chromium.launch();
  const clientContext = await browser.newContext();
  const bidderContext = await browser.newContext();
  const adminContext = await browser.newContext();
  if (process.env.SMOKE_VERCEL_BYPASS) {
    for (const context of [clientContext, bidderContext, adminContext]) {
      await context.route(`${origin}/**`, (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            "x-vercel-protection-bypass": process.env.SMOKE_VERCEL_BYPASS,
          },
        }),
      );
    }
  }
  const adminAccount = await seedClient("admin");
  ok(
    await admin
      .from("profiles")
      .update({ role: "admin", approval_status: "approved" })
      .eq("id", adminAccount.id),
  );
  ok(
    await administrator.auth.signInWithPassword({
      email: adminAccount.email,
      password,
    }),
  );
  const ap = await adminContext.newPage();
  ap.setDefaultTimeout(30000);
  await ap.goto(`${origin}/auth/login`);
  await ap
    .getByLabel("Email address", { exact: true })
    .fill(adminAccount.email);
  await ap.getByLabel("Password", { exact: true }).fill(password);
  await ap
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(ap).toHaveURL(/\/dashboard/);
  const cp = await clientContext.newPage(),
    bp = await bidderContext.newPage();
  cp.setDefaultTimeout(20000);
  bp.setDefaultTimeout(20000);
  const ownerEmail = `${prefix}-client@example.com`;
  await cp.goto(`${origin}/auth/signup`);
  await cp.getByLabel("Your name", { exact: true }).fill("Smoke Client");
  await cp.getByLabel("Email address", { exact: true }).fill(ownerEmail);
  await cp.getByLabel("Password", { exact: true }).fill(password);
  await cp
    .getByRole("button", { name: "Create your workspace", exact: true })
    .click();
  await expect(cp).toHaveURL(/\/auth\/approval/, { timeout: 45000 });
  const owner = ok(
    await admin.from("profiles").select("id").eq("email", ownerEmail).single(),
  );
  users.push(owner.id);
  workspaces.push(
    ok(
      await admin
        .from("workspaces")
        .select("id")
        .eq("owner_id", owner.id)
        .single(),
    ).id,
  );
  ok(await client.auth.signInWithPassword({ email: ownerEmail, password }));
  assert.equal(
    ok(
      await client
        .from("profiles")
        .select("approval_status")
        .eq("id", owner.id)
        .single(),
    ).approval_status,
    "pending",
  );
  assert.deepEqual(ok(await client.from("workspaces").select("id")), []);
  await cp.goto(`${origin}/bids`);
  await expect(cp).toHaveURL(/\/auth\/approval/);
  assert.ok(
    (
      await client.rpc("invite_bidder", {
        p_workspace: workspaces[0],
        p_email: `${prefix}-forbidden@example.com`,
        p_name: "Forbidden",
        p_rate: 1,
      })
    ).error,
  );
  await ap.goto(`${origin}/users`);
  await ap.getByRole("button", { name: /^pending/i }).click();
  await ap.getByLabel("Search people").fill(ownerEmail);
  await ap.getByRole("button", { name: "Reject", exact: true }).click();
  await ap
    .getByLabel("Rejection reason")
    .fill("Please confirm your workspace details");
  await ap.getByRole("button", { name: "Reject registration" }).click();
  await expect(ap.getByText("Client rejected", { exact: true })).toBeVisible();
  await cp.reload();
  await expect(
    cp.getByText("Please confirm your workspace details", { exact: true }),
  ).toBeVisible();
  await ap.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(ap.getByText("Client approved", { exact: true })).toBeVisible();
  await cp.goto(`${origin}/dashboard`);
  await expect(cp).toHaveURL(/\/dashboard/);
  pass(
    "Signup is pending; URL and direct API access blocked; admin rejects with visible reason then approves",
  );
  await ap.goto(`${origin}/users`);
  await ap.getByRole("button", { name: "Add client", exact: true }).click();
  await ap
    .getByRole("dialog")
    .getByLabel("Full name", { exact: true })
    .fill("Managed Client");
  const managedEmail = `${prefix}-managed@example.com`;
  await ap
    .getByRole("dialog")
    .getByLabel("Email address", { exact: true })
    .fill(managedEmail);
  await ap.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(ap.getByText("Client created", { exact: true })).toBeVisible();
  const managed = ok(
    await admin.from("profiles").select("*").eq("email", managedEmail).single(),
  );
  users.push(managed.id);
  assert.equal(managed.approval_status, "approved");
  await ap.getByLabel("Search people").fill(managedEmail);
  await ap.getByRole("button", { name: "Manage", exact: true }).click();
  await ap.getByLabel("Account status").selectOption("true");
  await ap.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(ap.getByText("Account updated", { exact: true })).toBeVisible();
  await ap.getByRole("button", { name: /^archived$/i }).click();
  await ap.getByRole("button", { name: "Manage", exact: true }).click();
  await ap.getByLabel("Account status").selectOption("false");
  await ap.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(
      async () =>
        ok(
          await admin
            .from("profiles")
            .select("archived")
            .eq("id", managed.id)
            .single(),
        ).archived,
    )
    .toBe(false);
  pass(
    "Admin creates an automatically approved client and archives/restores it through Users",
  );
  const outsider = await seedClient("other");
  ok(
    await administrator.rpc("review_client", {
      p_client: outsider.id,
      p_status: "approved",
      p_reason: null,
    }),
  );
  workspaces.push(
    ok(
      await admin
        .from("workspaces")
        .select("id")
        .eq("owner_id", outsider.id)
        .single(),
    ).id,
  );
  ok(await other.auth.signInWithPassword({ email: outsider.email, password }));
  let bidderEmail = `${prefix}-bidder@example.com`;
  await cp.goto(`${origin}/users`);
  await cp.getByRole("button", { name: "Add bidder", exact: true }).click();
  await cp.getByLabel("Full name", { exact: true }).fill("Smoke Bidder");
  await cp.getByLabel("Email address", { exact: true }).fill(bidderEmail);
  await cp
    .getByLabel("Default rate per bid (USD)", { exact: true })
    .fill("1.25");
  await cp.getByRole("button", { name: "Create bidder", exact: true }).click();
  const creationNotice = cp.locator("[data-sonner-toast]").first();
  await expect(creationNotice).toBeVisible({ timeout: 30000 });
  assert.match(await creationNotice.innerText(), /Bidder account created/);
  const invited = ok(
    await admin
      .from("profiles")
      .select("id,email")
      .eq("email", bidderEmail)
      .single(),
  );
  users.push(invited.id);
  await cp.getByRole("button", { name: "Manage", exact: true }).click();
  bidderEmail = `${prefix}-renamed@example.com`;
  await cp.getByLabel("Email address", { exact: true }).fill(bidderEmail);
  await cp.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(cp.getByText("Account updated", { exact: true })).toBeVisible();
  assert.equal(
    ok(await admin.auth.admin.getUserById(invited.id)).user.email,
    bidderEmail,
  );
  assert.equal(
    ok(
      await admin
        .from("profiles")
        .select("email")
        .eq("id", invited.id)
        .single(),
    ).email,
    bidderEmail,
  );
  invited.email = bidderEmail;
  await cp.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(
    cp.getByRole("button", { name: "Reset password", exact: true }),
  ).toBeDisabled();
  await cp.getByRole("checkbox").check();
  await cp.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(
    cp.getByText("Password reset to 123456", { exact: true }),
  ).toBeVisible();
  await cp.keyboard.press("Escape");
  pass(
    "Managed email change synchronizes Auth/profile and password reset requires explicit confirmation",
  );
  await bp.goto(`${origin}/auth/login`);
  await bp.getByLabel("Email address", { exact: true }).fill(bidderEmail);
  await bp.getByLabel("Password", { exact: true }).fill("123456");
  await bp
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(bp).toHaveURL(/\/dashboard/, { timeout: 30000 });
  await bp.goto(`${origin}/settings`);
  await bp.getByRole("link", { name: "Change password", exact: true }).click();
  await bp.getByLabel("New password", { exact: true }).fill(password);
  await bp.getByRole("button", { name: "Save password" }).click();
  await expect(bp).toHaveURL(/\/dashboard/, { timeout: 30000 });
  ok(await bidder.auth.signInWithPassword({ email: invited.email, password }));
  const oldLogin = createClient(url, key, options);
  assert.ok(
    (
      await oldLogin.auth.signInWithPassword({
        email: invited.email,
        password: "123456",
      })
    ).error,
  );
  assert.equal(
    ok(
      await bidder
        .from("profiles")
        .select("role")
        .eq("id", invited.id)
        .single(),
    ).role,
    "bidder",
  );
  assert.ok(
    ok(
      await client
        .from("invitations")
        .select("accepted_at")
        .eq("email", bidderEmail)
        .single(),
    ).accepted_at,
  );
  pass(
    "Client creates bidder without email; 123456 signs in; Settings password change disables old password",
  );

  await cp.goto(`${origin}/resumes`);
  await cp
    .getByRole("button", { name: "New resume", exact: true })
    .first()
    .click();
  await cp.getByLabel("Resume identifier", { exact: true }).fill("SMOKE-01");
  await cp
    .getByLabel("Candidate name", { exact: true })
    .fill("Smoke Candidate");
  await cp
    .getByLabel("Email address", { exact: true })
    .fill("candidate@example.com");
  await cp
    .getByLabel("Rate override per bid (USD)", { exact: true })
    .fill("2.50");
  await cp.getByRole("button", { name: "Create profile", exact: true }).click();
  await expect(
    cp.getByText("Resume profile saved", { exact: true }),
  ).toBeVisible();
  const resume = ok(
    await client
      .from("resumes")
      .select("*")
      .eq("identifier", "SMOKE-01")
      .single(),
  );
  await cp.getByRole("button", { name: /SMOKE-01/ }).click();
  const pdf = await cp.pdf({ format: "A4" });
  await cp.getByLabel("Choose resume file", { exact: true }).setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(cp.getByText("Resume file saved", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await bp.goto(`${origin}/resumes`);
  await bp.getByRole("button", { name: /SMOKE-01/ }).click();
  await expect(bp.getByRole("button", { name: "Edit profile" })).toHaveCount(0);
  await bp.getByRole("button", { name: "Open resume", exact: true }).click();
  const signed = await bp
    .getByRole("link", { name: /View securely/ })
    .getAttribute("href");
  assert.equal((await fetch(signed)).status, 200);
  pass(
    "Client creates resume/rate and uploads a real private PDF; bidder can read/download",
  );

  await bp.goto(`${origin}/bids`);
  await bp
    .getByRole("button", { name: "Add bid", exact: true })
    .first()
    .click();
  await bp
    .getByLabel("Job URL", { exact: true })
    .fill("https://example.com/jobs/123?utm_source=smoke");
  await bp.getByLabel("Company name", { exact: true }).fill("Smoke Company");
  await bp.getByLabel("Role name", { exact: true }).fill("Engineer");
  await bp
    .getByLabel("Jobsite source", { exact: true })
    .fill("Company website");
  await bp
    .getByRole("button", { name: "Add opportunity", exact: true })
    .click();
  await expect(
    bp.getByText("Opportunity added", { exact: true }),
  ).toBeVisible();
  const bid = ok(
    await bidder.from("bids").select("*").eq("resume_id", resume.id).single(),
  );
  await openBid(bp);
  await bp
    .getByRole("dialog")
    .getByLabel("Choose screenshot", { exact: true })
    .setInputFiles({
      name: "invalid.png",
      mimeType: "image/png",
      buffer: Buffer.from("Not a real PNG"),
    });
  await expect(
    bp
      .getByText("The file contents do not match its type.", { exact: true })
      .first(),
  ).toBeVisible({ timeout: 45000 });
  assert.equal((await readBid(bid.id)).applied, false);
  await expect(
    bp.getByRole("button", { name: "Mark as applied", exact: true }),
  ).toHaveCount(0);
  pass("Invalid screenshot bytes cannot finalize or change application status");
  let proof = await bp.screenshot();
  await uploadProof(bp, proof);
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toBeVisible();
  const applied = await readBid(bid.id);
  assert.equal(applied.applied, true);
  assert.equal(applied.rate_cents, 250);
  await openBid(bp);
  proof = await cp.screenshot();
  await uploadProof(bp, proof);
  const replaced = await readBid(bid.id);
  assert.equal(replaced.first_applied_at, applied.first_applied_at);
  assert.equal(replaced.rate_cents, 250);
  assert.ok(Date.parse(replaced.applied_at) > Date.parse(applied.applied_at));
  pass(
    "Replacement proof updates latest application time and preserves first earning date/rate",
  );
  await openBid(bp);
  await expect(bp.getByLabel("Correction reason", { exact: true })).toHaveCount(
    0,
  );
  pass(
    "Bidder creates a bid, uploads evidence through Storage HTTP, and earns the resume rate",
  );

  assert.deepEqual(
    ok(await other.from("bids").select("id").eq("id", bid.id)),
    [],
  );
  assert.deepEqual(
    ok(await other.from("resumes").select("id").eq("id", resume.id)),
    [],
  );
  const tamper = await bidder
    .from("bids")
    .update({ rate_cents: 99999 })
    .eq("id", bid.id)
    .select("id");
  // RLS may return zero affected rows rather than an HTTP permission error.
  if (!tamper.error) assert.deepEqual(tamper.data, []);
  assert.equal((await readBid(bid.id)).rate_cents, 250);
  const file = ok(
    await admin
      .from("files")
      .select("*")
      .eq("id", applied.evidence_file_id)
      .single(),
  );
  assert.ok(
    (await other.storage.from("private-files").download(file.storage_path))
      .error,
  );
  assert.ok(
    (
      await bidder.storage
        .from("private-files")
        .update(file.storage_path, proof, { contentType: "image/png" })
    ).error,
  );
  assert.ok(
    (
      await bidder.rpc("set_applied", {
        p_bid: bid.id,
        p_applied: false,
        p_file: null,
        p_reason: "Forbidden",
      })
    ).error,
  );
  pass(
    "Direct HTTP requests deny cross-tenant reads, file access, evidence overwrites, and bidder corrections",
  );

  await openBid(cp);
  await cp
    .getByLabel("Correction reason", { exact: true })
    .fill("Please upload the correct confirmation");
  await cp.getByRole("button", { name: "Mark unapplied", exact: true }).click();
  await expect(cp.getByText("Marked unapplied", { exact: true })).toBeVisible();
  assert.equal((await readBid(bid.id)).applied, false);
  ok(
    await client.rpc("update_bidder", {
      p_bidder: invited.id,
      p_name: "Smoke Bidder",
      p_rate: 999,
      p_archived: false,
    }),
  );
  ok(
    await client.rpc("save_resume", {
      p_id: resume.id,
      p_workspace: workspaces[0],
      p_bidder: invited.id,
      p_identifier: "SMOKE-01",
      p_name: "Smoke Candidate",
      p_email: "candidate@example.com",
      p_phone: "",
      p_address: "",
      p_links: "",
      p_instructions: "",
      p_rate: 999,
    }),
  );
  await openBid(bp);
  await uploadProof(bp, proof, false);
  await expect(
    bp.getByText(/this screenshot was previously rejected/i).first(),
  ).toBeVisible();
  assert.equal((await readBid(bid.id)).applied, false);
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toHaveCount(0);
  await bp
    .getByRole("dialog")
    .getByLabel("Choose screenshot", { exact: true })
    .setInputFiles({
      name: "new-proof.png",
      mimeType: "image/png",
      buffer: await cp.screenshot(),
    });
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toBeVisible();
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toBeVisible();
  const restored = await readBid(bid.id);
  assert.equal(restored.applied, true);
  assert.equal(restored.rate_cents, 250);
  assert.equal(restored.first_applied_at, applied.first_applied_at);
  const verified = ok(
    await admin
      .from("files")
      .select("sha256")
      .eq("id", restored.evidence_file_id)
      .single(),
  );
  const retry = await Promise.all(
    [1, 2].map(() =>
      admin.rpc("finalize_verified_file", {
        p_id: restored.evidence_file_id,
        p_sha: verified.sha256,
        p_actor: invited.id,
      }),
    ),
  );
  retry.forEach(ok);
  assert.equal(
    ok(
      await client
        .from("bid_events")
        .select("id")
        .eq("bid_id", bid.id)
        .eq("event", "applied"),
    ).length,
    2,
  );
  pass(
    "Correction removes earnings; old proof fails; new proof restores one original earning despite changed rates/retries",
  );
  await bp.goto(`${origin}/bids`);
  await bp.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(
    bp.getByText("Bid moved to trash", { exact: true }),
  ).toBeVisible();
  assert.ok((await readBid(bid.id)).deleted_at);
  await bp.getByRole("button", { name: "Trash", exact: true }).click();
  await bp.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(bp.getByText("Bid restored", { exact: true })).toBeVisible();
  assert.equal((await readBid(bid.id)).deleted_at, null);
  assert.equal((await readBid(bid.id)).rate_cents, 250);
  pass(
    "Bidder trashes and restores a bid through the table, preserving prior application and one earning",
  );
  await bp.goto(`${origin}/earnings`);
  await expect(bp.getByText("$2.50", { exact: true }).first()).toBeVisible();
  ok(
    await administrator.rpc("update_client", {
      p_client: owner.id,
      p_name: "Smoke Client",
      p_archived: true,
    }),
  );
  assert.deepEqual(ok(await client.from("bids").select("id")), []);
  assert.deepEqual(ok(await bidder.from("bids").select("id")), []);
  ok(
    await administrator.rpc("update_client", {
      p_client: owner.id,
      p_name: "Smoke Client",
      p_archived: false,
    }),
  );
  assert.equal(ok(await bidder.from("bids").select("id")).length, 1);
  pass(
    "Client archival blocks both owner and descendant bidder; restoration reinstates access",
  );
  // Real clipboard-style import followed by inline editing against hosted Postgres.
  await bp.goto(`${origin}/bids`);
  await bp
    .getByRole("button", { name: "Paste from Sheets", exact: true })
    .click();
  await bp.getByLabel("Import resume", { exact: true }).selectOption(resume.id);
  await bp.getByLabel("Added date (CT)", { exact: true }).fill("2026-03-08");
  await bp
    .getByLabel("Copied Google Sheets cells")
    .fill(
      'Imported One\tEngineer\thttps://example.com/import/one\n"Imported Two"\tDesigner\thttps://example.com/import/two',
    );
  await bp.getByRole("button", { name: "Read columns" }).click();
  await bp.getByRole("button", { name: "Preview bids" }).click();
  await expect(
    bp.getByRole("button", { name: "Import 2 bids", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await bp.getByRole("button", { name: "Import 2 bids", exact: true }).click();
  await expect(bp.getByText("2 bids imported", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  const imported = ok(
    await bidder
      .from("bids")
      .select("*")
      .like("url", "https://example.com/import/%"),
  );
  assert.equal(imported.length, 2);
  for (const row of imported) {
    assert.equal(
      new Date(row.found_at).toISOString(),
      "2026-03-08T06:00:00.000Z",
    );
    assert.equal(row.applied, false);
    assert.equal(row.rate_cents, null);
  }
  const cell = bp.getByRole("gridcell", { name: "Imported One", exact: true });
  await cell.dblclick();
  await bp
    .getByRole("textbox", { name: "Edit company", exact: true })
    .fill("Edited Import");
  await bp
    .getByRole("textbox", { name: "Edit company", exact: true })
    .press("Enter");
  await expect(
    bp.getByRole("gridcell", { name: "Edited Import", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const one = imported.find((r) => r.company === "Imported One");
  let current = await readBid(one.id);
  assert.equal(current.company, "Edited Import");
  const races = await Promise.all(
    ["Concurrent A", "Concurrent B"].map((value) =>
      bidder.rpc("update_bid_cell", {
        p_bid: one.id,
        p_field: "company",
        p_value: value,
        p_version: current.version,
      }),
    ),
  );
  assert.equal(races.filter((r) => ok(r).ok).length, 1);
  assert.equal(races.filter((r) => ok(r).conflict).length, 1);
  const payload = {
    p_resume: resume.id,
    p_date: "2026-11-01",
    p_rows: [
      {
        company: "Retry",
        role_name: "Engineer",
        url: "https://example.com/import/retry",
        source: "",
        arrangement: "remote",
        job_status: "open",
      },
    ],
    p_request: randomUUID(),
  };
  // Use a past fall DST date, independent of the wall clock's current month.
  payload.p_date = "2025-11-02";
  const receipts = await Promise.all([
    bidder.rpc("import_bids", payload),
    bidder.rpc("import_bids", payload),
  ]);
  assert.deepEqual(ok(receipts[0]), ok(receipts[1]));
  assert.equal(ok(receipts[0]).ids.length, 1);
  assert.equal(
    new Date((await readBid(ok(receipts[0]).ids[0])).found_at).toISOString(),
    "2025-11-02T05:00:00.000Z",
  );
  assert.ok(
    (
      await bidder.rpc("import_bids", {
        ...payload,
        p_rows: [{ ...payload.p_rows[0], company: "Different" }],
      })
    ).error,
  );
  const rollback = ok(
    await bidder.rpc("import_bids", {
      ...payload,
      p_request: randomUUID(),
      p_rows: [
        {
          ...payload.p_rows[0],
          url: "https://example.com/import/must-rollback",
        },
        payload.p_rows[0],
      ],
    }),
  );
  assert.ok(rollback.errors.length);
  assert.equal(
    ok(
      await bidder
        .from("bids")
        .select("id")
        .eq("url", "https://example.com/import/must-rollback"),
    ).length,
    0,
  );
  pass(
    "Sheets UI imports historical rows, inline edit persists, concurrent edits conflict, import retries deduplicate and invalid batches roll back",
  );
  // Purge only this run's synthetic import. Include finalized and unfinished files.
  const purgeBid = await readBid(ok(receipts[0]).ids[0]);
  ok(
    await bidder.rpc("update_bid_cell", {
      p_bid: purgeBid.id,
      p_field: "company",
      p_value: "Purge UI",
      p_version: purgeBid.version,
    }),
  );
  const purgePaths = [];
  for (const finalized of [true, false]) {
    const id = ok(
      await bidder.rpc("prepare_file", {
        p_kind: "screenshot",
        p_target: purgeBid.id,
        p_filename: "purge.png",
        p_mime: "image/png",
        p_size: proof.length,
      }),
    );
    const f = ok(await admin.from("files").select("*").eq("id", id).single());
    purgePaths.push(f.storage_path);
    ok(
      await bidder.storage
        .from("private-files")
        .upload(f.storage_path, proof, { contentType: "image/png" }),
    );
    if (finalized)
      ok(
        await admin.rpc("finalize_verified_file", {
          p_id: id,
          p_actor: invited.id,
          p_sha: createHash("sha256").update(proof).digest("hex"),
        }),
      );
  }
  await cp.goto(`${origin}/bids`);
  await cp.getByRole("button", { name: "All dates", exact: true }).click();
  await cp.getByLabel("Search bids").fill("Purge UI");
  await cp.getByRole("checkbox", { name: "Select current page" }).check();
  await cp
    .getByRole("button", { name: "Move selected to trash", exact: true })
    .click();
  await expect(
    cp.getByText("Selected bids moved to trash", { exact: true }),
  ).toBeVisible();
  await cp.getByRole("button", { name: "Trash", exact: true }).click();
  await cp.getByRole("checkbox", { name: "Select current page" }).check();
  await cp
    .getByRole("button", { name: "Delete selected permanently", exact: true })
    .click();
  await expect(
    cp.getByRole("heading", { name: "Permanently delete 1 bids?" }),
  ).toBeVisible();
  await cp.getByLabel("Type DELETE to confirm").fill("DELETE");
  await cp
    .getByRole("button", { name: "Permanently delete", exact: true })
    .click();
  await expect(cp.getByText(/1 applications deleted\./).first()).toBeVisible();
  const operation = ok(
    await admin
      .from("bid_purge_operations")
      .select("*")
      .eq("actor_id", owner.id)
      .not("completed_at", "is", null)
      .single(),
  );
  assert.deepEqual(
    ok(await client.rpc("confirm_bid_purge", { p_operation: operation.id })),
    { id: operation.id, deletedCount: 1 },
  );
  assert.ok(
    (await other.rpc("retry_bid_cleanup", { p_operation: operation.id })).error,
  );
  assert.equal(ok(await bidder.rpc("import_bids", payload)).purgedCount, 1);
  assert.equal(
    ok(await admin.from("bids").select("id").eq("id", purgeBid.id)).length,
    0,
  );
  assert.equal(
    ok(await admin.from("bid_events").select("id").eq("bid_id", purgeBid.id))
      .length,
    0,
  );
  assert.equal(
    ok(await admin.from("files").select("id").eq("bid_id", purgeBid.id)).length,
    0,
  );
  for (const path of purgePaths)
    assert.ok((await admin.storage.from("private-files").download(path)).error);
  assert.equal(
    ok(await client.rpc("bid_purge_status", { p_operation: operation.id }))
      .verifyingFiles,
    2,
  );
  // Simulate an upload finishing after the initial removal, on this synthetic path only.
  ok(
    await admin.storage
      .from("private-files")
      .upload(purgePaths[1], proof, { contentType: "image/png" }),
  );
  ok(
    await admin
      .from("storage_cleanup_tasks")
      .update({ next_attempt_at: new Date(0).toISOString() })
      .eq("operation_id", operation.id),
  );
  assert.ok(process.env.CRON_SECRET, "Staging CRON_SECRET required");
  const cronHeaders = {
    authorization: `Bearer ${process.env.CRON_SECRET}`,
    ...(process.env.SMOKE_VERCEL_BYPASS
      ? { "x-vercel-protection-bypass": process.env.SMOKE_VERCEL_BYPASS }
      : {}),
  };
  const cron = await fetch(`${origin}/api/cron/storage-cleanup`, {
    headers: cronHeaders,
  });
  assert.equal(cron.status, 200);
  assert.equal(
    ok(await client.rpc("bid_purge_status", { p_operation: operation.id }))
      .pendingFiles,
    0,
  );
  for (const path of purgePaths)
    assert.ok((await admin.storage.from("private-files").download(path)).error);
  assert.equal(
    ok(await admin.from("resumes").select("id").eq("id", resume.id)).length,
    1,
  );
  pass(
    "Bulk checkbox trash and permanent deletion remove history/all proof; import retry cannot resurrect; delayed cron catches in-flight files",
  );
  const emptyBid = ok(
    await bidder.rpc("save_bid", {
      p_id: null,
      p_resume: resume.id,
      p_company: "Empty scope",
      p_role: "Engineer",
      p_url: "https://example.com/purge/empty",
      p_source: "",
      p_arrangement: "remote",
      p_status: "open",
    }),
  );
  ok(await bidder.rpc("trash_bid", { p_bid: emptyBid, p_deleted: true }));
  assert.ok(
    (
      await bidder.rpc("prepare_bid_purge", {
        p_mode: "all",
        p_targets: [],
        p_bidder: null,
      })
    ).error,
  );
  await cp.getByLabel("Search bids").fill("no matching rows");
  await cp.getByRole("button", { name: "Today (CT)", exact: true }).click();
  await cp.getByRole("button", { name: "Empty trash", exact: true }).click();
  await expect(
    cp.getByRole("heading", { name: "Permanently delete 1 bids?" }),
  ).toBeVisible();
  await expect(cp.getByRole("dialog")).toContainText(
    "All trash in your workspace",
  );
  await cp.getByLabel("Type DELETE to confirm").fill("DELETE");
  await cp
    .getByRole("button", { name: "Permanently delete", exact: true })
    .click();
  await expect(cp.getByRole("dialog")).toHaveCount(0);
  assert.equal(
    ok(await admin.from("bids").select("id").eq("id", emptyBid)).length,
    0,
  );
  pass(
    "Empty trash ignores date/search filters within the client workspace; bidders cannot purge",
  );
  ok(
    await client.rpc("update_bidder", {
      p_bidder: invited.id,
      p_name: "Smoke Bidder",
      p_rate: 999,
      p_archived: true,
    }),
  );
  assert.deepEqual(ok(await bidder.from("bids").select("id")), []);
  assert.ok(
    (await bidder.storage.from("private-files").download(file.storage_path))
      .error,
  );
  await bp.goto(`${origin}/dashboard`);
  await expect(bp).toHaveURL(/\/auth\/inactive/);
  assert.equal((await readBid(bid.id)).rate_cents, 250);
  pass(
    "Earnings render correctly; archiving revokes database, storage, and app access while retaining history",
  );
} finally {
  await browser?.close();
  // Remove only this run's synthetic staging records; never touch other workspaces.
  // Discover records even if the browser failed before a create response arrived.
  const ownProfiles = ok(
    await admin.from("profiles").select("id").like("email", `${prefix}-%`),
  );
  for (const profile of ownProfiles)
    if (!users.includes(profile.id)) users.push(profile.id);
  if (users.length) {
    const ownWorkspaces = ok(
      await admin.from("workspaces").select("id").in("owner_id", users),
    );
    for (const workspace of ownWorkspaces)
      if (!workspaces.includes(workspace.id)) workspaces.push(workspace.id);
  }
  if (workspaces.length) {
    const files = ok(
      await admin
        .from("files")
        .select("storage_path")
        .in("workspace_id", workspaces),
    );
    if (files.length)
      ok(
        await admin.storage
          .from("private-files")
          .remove(files.map((f) => f.storage_path)),
      );
    const bids = ok(
      await admin.from("bids").select("id").in("workspace_id", workspaces),
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
        .in("workspace_id", workspaces),
    );
    ok(
      await admin
        .from("resumes")
        .update({ file_id: null })
        .in("workspace_id", workspaces),
    );
    for (const table of ["files", "bids", "resumes", "invitations", "bidders"])
      ok(await admin.from(table).delete().in("workspace_id", workspaces));
    ok(await admin.from("workspaces").delete().in("id", workspaces));
  }
  if (users.length) {
    const ops = ok(
      await admin
        .from("bid_purge_operations")
        .select("id")
        .in("actor_id", users),
    );
    if (ops.length) {
      const opIds = ops.map((o) => o.id);
      const tasks = ok(
        await admin
          .from("storage_cleanup_tasks")
          .select("storage_path")
          .in("operation_id", opIds),
      );
      const paths = tasks.map((t) => t.storage_path).filter(Boolean);
      if (paths.length)
        ok(await admin.storage.from("private-files").remove(paths));
      ok(
        await admin
          .from("storage_cleanup_tasks")
          .delete()
          .in("operation_id", opIds),
      );
      ok(await admin.from("bid_purge_operations").delete().in("id", opIds));
    }
    ok(await admin.from("bid_import_receipts").delete().in("actor_id", users));
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
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/hosted-smoke.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        checks,
        cleanup: "complete",
        emailDeliveryTested: false,
      },
      null,
      2,
    ),
  );
  console.log("Synthetic staging accounts and files cleaned up.");
}

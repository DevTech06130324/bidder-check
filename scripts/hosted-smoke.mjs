// Run only against the dedicated staging project. No email is sent by this test.
// node --env-file=.env.staging scripts/hosted-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://kdmvludtvhuuewmhurpw.supabase.co", "Staging only");
const origin = process.env.SMOKE_APP_URL ?? "http://localhost:3002";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(url, key, options);
const bidder = createClient(url, key, options);
const other = createClient(url, key, options);
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
async function uploadProof(page, buffer) {
  await page
    .getByLabel("Choose screenshot", { exact: true })
    .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer });
  await expect(page.getByText("Screenshot verified and ready")).toBeVisible({
    timeout: 45000,
  });
  await page
    .getByRole("button", { name: "Mark as applied", exact: true })
    .click();
}
try {
  browser = await chromium.launch();
  const clientContext = await browser.newContext();
  const bidderContext = await browser.newContext();
  if (process.env.SMOKE_VERCEL_BYPASS) {
    for (const context of [clientContext, bidderContext]) {
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
  await expect(cp).toHaveURL(/\/dashboard/, { timeout: 45000 });
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
  pass(
    "Client self-registration immediately creates a session and workspace without email",
  );
  const outsider = await seedClient("other");
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
  const bidderEmail = `${prefix}-bidder@example.com`;
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
  await bp.getByLabel("Choose screenshot", { exact: true }).setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("Not a real PNG"),
  });
  await expect(
    bp.getByText("The file contents do not match its type.", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  assert.equal((await readBid(bid.id)).applied, false);
  await expect(
    bp.getByRole("button", { name: "Mark as applied", exact: true }),
  ).toBeDisabled();
  pass("Invalid screenshot bytes cannot finalize or change application status");
  const proof = await bp.screenshot();
  await uploadProof(bp, proof);
  await expect(
    bp.getByText("Application recorded", { exact: true }),
  ).toBeVisible();
  const applied = await readBid(bid.id);
  assert.equal(applied.applied, true);
  assert.equal(applied.rate_cents, 250);
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
  await uploadProof(bp, proof);
  await expect(
    bp.getByText(/new.*screenshot|already.*used|identical|new proof/i),
  ).toBeVisible();
  assert.equal((await readBid(bid.id)).applied, false);
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toHaveCount(0);
  await bp.getByLabel("Choose screenshot", { exact: true }).setInputFiles({
    name: "new-proof.png",
    mimeType: "image/png",
    buffer: await cp.screenshot(),
  });
  await expect(
    bp.getByText("Screenshot uploaded", { exact: true }),
  ).toBeVisible();
  await bp
    .getByRole("button", { name: "Mark as applied", exact: true })
    .click();
  await expect(
    bp.getByText("Application recorded", { exact: true }),
  ).toBeVisible();
  const restored = await readBid(bid.id);
  assert.equal(restored.applied, true);
  assert.equal(restored.rate_cents, 250);
  assert.equal(restored.first_applied_at, applied.first_applied_at);
  const retry = await Promise.all(
    [1, 2].map(() =>
      bidder.rpc("set_applied", {
        p_bid: bid.id,
        p_applied: true,
        p_file: restored.evidence_file_id,
        p_reason: null,
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
  await bp.goto(`${origin}/earnings`);
  await expect(bp.getByText("$2.50", { exact: true }).first()).toBeVisible();
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

// Staging-only regression: a bidder in an admin-owned workspace remains manageable.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
assert.equal(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "https://kdmvludtvhuuewmhurpw.supabase.co",
  "Staging only",
);
const origin = process.env.SMOKE_APP_URL;
assert.ok(origin, "Set SMOKE_APP_URL to the staging deployment");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const ids = [];
const password = `Check-${randomUUID()}!`;
const prefix = `people-${randomUUID()}`;
const ok = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
let browser;
try {
  for (const role of ["admin", "bidder"]) {
    const user = ok(
      await admin.auth.admin.createUser({
        email: `${prefix}-${role}@example.com`,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Visibility ${role}` },
      }),
    ).user;
    ids.push(user.id);
    ok(
      await admin
        .from("profiles")
        .update({ role, approval_status: "approved" })
        .eq("id", user.id),
    );
  }
  const workspace = ok(
    await admin.from("workspaces").select("id").eq("owner_id", ids[0]).single(),
  );
  ok(
    await admin.from("bidders").insert({
      user_id: ids[1],
      workspace_id: workspace.id,
      default_rate_cents: 125,
    }),
  );
  browser = await chromium.launch();
  const context = await browser.newContext();
  context.setDefaultTimeout(30000);
  if (process.env.SMOKE_VERCEL_BYPASS) {
    await context.route(`${origin}/**`, (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "x-vercel-protection-bypass": process.env.SMOKE_VERCEL_BYPASS,
        },
      }),
    );
  }
  const page = await context.newPage();
  await page.goto(`${origin}/auth/login`);
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`${prefix}-admin@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`${origin}/users`);
  const section = page.getByRole("region", {
    name: "Bidders without a client",
  });
  await expect(
    section.getByRole("link", { name: "Visibility bidder", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search people").fill(`${prefix}-bidder@example.com`);
  await section.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByLabel("Default rate per bid (USD)").fill("1.50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page.getByText("Account updated", { exact: true }),
  ).toBeVisible();
  assert.equal(
    ok(
      await admin
        .from("bidders")
        .select("default_rate_cents")
        .eq("user_id", ids[1])
        .single(),
    ).default_rate_cents,
    150,
  );
  await section
    .getByRole("link", { name: "Visibility bidder", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/users/${ids[1]}$`));
  await expect(
    page.getByRole("heading", { name: "Visibility bidder", exact: true }),
  ).toBeVisible();
  console.log(
    "PASS hosted admin can find, edit and open an admin-owned bidder",
  );
} finally {
  await browser?.close();
  if (ids.length) {
    ok(await admin.from("bidders").delete().in("user_id", ids));
    ok(await admin.from("account_events").delete().in("account_id", ids));
    ok(await admin.from("workspaces").delete().in("owner_id", ids));
    ok(await admin.from("profiles").delete().in("id", ids));
    for (const id of ids) ok(await admin.auth.admin.deleteUser(id));
  }
  console.log("Synthetic visibility-check accounts removed");
}

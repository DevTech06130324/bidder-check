import { test, expect } from "@playwright/test";

test("admin can find and manage bidders without a client across account views", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/admin-users");
  await expect(
    page.getByRole("link", { name: "Independent Bidder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Archived Independent", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No matching clients", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search people").fill("independent@example.test");
  await expect(
    page.getByRole("link", { name: "Independent Bidder", exact: true }),
  ).toHaveAttribute("href", "/users/standalone");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manage Independent Bidder" }),
  ).toBeVisible();
  await expect(page.getByLabel("Default rate per bid (USD)")).toHaveValue(
    "1.25",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Search people").fill("");
  await page.getByRole("button", { name: /^archived$/i }).click();
  await expect(
    page.getByRole("link", { name: "Archived Independent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Independent Bidder", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^pending/i }).click();
  await expect(
    page.getByRole("link", { name: "Archived Independent", exact: true }),
  ).toHaveCount(0);
  await page.goto("http://127.0.0.1:3001/users");
  await expect(
    page.getByRole("link", { name: "Jamie Parker", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Independent Bidder", exact: true }),
  ).toHaveCount(0);
});

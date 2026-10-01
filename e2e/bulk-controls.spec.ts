import { test, expect } from "@playwright/test";
test("checkbox selection spans pages, remains separate from cells and resets on filters", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  await page.getByRole("button", { name: "All dates", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select current page" }).check();
  await expect(page.getByText("10 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select current page" }).check();
  await expect(page.getByText("12 selected", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Move selected to trash", exact: true })
    .click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select current page" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Select current page" }).check();
  await page
    .getByRole("button", { name: "Delete selected permanently", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Permanently delete", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(
    page.getByRole("button", { name: "Permanently delete", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Today (CT)", exact: true }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});
test("Sheets import has data-only mapping and only arrangement/status defaults", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  await page
    .getByRole("button", { name: "Paste from Sheets", exact: true })
    .click();
  await expect(page.getByLabel("Default company", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Default role", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Default job site", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("First row contains headers")).toHaveCount(0);
  await expect(page.getByLabel("Default work arrangement")).toHaveValue(
    "remote",
  );
  await expect(page.getByText(/paste without headings/i)).toBeVisible();
});

test("failed background refresh keeps the grid and its toolbar position", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids?refresh-failure");
  const cell = page.getByRole("gridcell", { name: "Linear", exact: true });
  await expect(cell).toBeVisible();
  const before = await cell.boundingBox();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("Refresh unavailable");
  await expect(cell).toBeVisible();
  // Errors are actionable; routine successful refreshes never mount extra rows.
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Refreshing bids...", { exact: true }),
  ).toHaveCount(0);
  expect(before?.height).toBe((await cell.boundingBox())?.height);
});

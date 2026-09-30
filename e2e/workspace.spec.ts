import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("dashboard has real component layout, responsive navigation, and no serious accessibility issues", async ({
  page,
}, testInfo) => {
  await page.goto("http://127.0.0.1:3001/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Alex." }),
  ).toBeVisible();
  await expect(page.getByText("Total earnings", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Today (CT)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    scan.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: `test-results/dashboard-dark-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("bid table search, filters and details show the correct application", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  await expect(
    page.getByRole("heading", { name: "Your bid workspace." }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search bids" }).fill("Linear");
  await expect(
    page.getByRole("gridcell", { name: "Linear", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1–1 of 1 bids")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "View Senior Frontend Engineer at Linear" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Senior Frontend Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark as applied" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Upload automatically records the application"),
  ).toBeVisible();
});
test("resume details and earnings render their scoped data", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/resumes");
  await page.getByRole("button", { name: /ENG-01 Jamie Parker/ }).click();
  await expect(
    page.getByText("APPLICATION INSTRUCTIONS", { exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3001/earnings");
  await expect(
    page.getByRole("heading", { name: "Every effort adds up." }),
  ).toBeVisible();
  await expect(page.getByText("$10.00").first()).toBeVisible();
});

test("daily table has ordered workflow columns, automatic timestamps and trash controls", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  await expect(
    page.getByRole("button", { name: "Today (CT)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("columnheader")).toHaveText([
    "#",
    "Added date (CT)",
    "Resume ID",
    "Company name",
    "Role",
    "Link",
    "Bidder ID",
    "Job site",
    "Applied status",
    "Applied time (CT)",
    "Work arrangement",
    "Job status",
    "Screenshot",
    "Actions",
  ]);
  await expect(page.getByText("1\u20131 of 1 bids")).toBeVisible();
  await page.getByRole("button", { name: "All dates", exact: true }).click();
  await expect(page.getByText("1\u201310 of 12 bids")).toBeVisible();
  await page.getByRole("button", { name: "Add bid", exact: true }).click();
  await expect(page.getByLabel(/Found time/)).toHaveCount(0);
});

test("spreadsheet keyboard edits preserve drafts, focus and rectangular copying", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  const company = page.locator('[data-grid-r="0"][data-field="company"]');
  await company.click();
  await page.keyboard.press("F2");
  const editor = page.getByRole("textbox", {
    name: "Edit company",
    exact: true,
  });
  await editor.fill("");
  await editor.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Required");
  await editor.fill("Grid Company");
  await editor.press("Enter");
  await expect(company).toContainText("Grid Company");
  await expect(company).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(
    page.locator('[role="gridcell"][aria-selected="true"]'),
  ).toHaveCount(2);
  const copied = await company.evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", { bubbles: true, clipboardData: data }),
    );
    return data.getData("text/plain");
  });
  expect(copied).toBe("Grid Company\tSenior Frontend Engineer");
  await page.keyboard.press("F2");
  await page.getByRole("textbox", { name: "Edit role_name" }).fill("Unsaved");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "Edit role_name" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Yesterday (CT)", exact: true })
    .click();
  await expect(page.getByText("1\u20131 of 1 bids")).toBeVisible();
  await expect(
    page.locator('[role="gridcell"][aria-selected="true"]'),
  ).toHaveCount(0);
});
test("Sheets mapping creates an editable preview and blocks invalid rows", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/bids");
  await page
    .getByRole("button", { name: "Paste from Sheets", exact: true })
    .click();
  await page
    .getByLabel("Import bidder", { exact: true })
    .selectOption("bidder-0");
  await page
    .getByLabel("Import resume", { exact: true })
    .selectOption("resume-0");
  await page
    .getByLabel("Copied Google Sheets cells")
    .fill("Acme\tEngineer\thttps://example.com/one\nTokyo\tDesigner\tbad-url");
  await page.getByRole("button", { name: "Read columns" }).click();
  await page.getByRole("button", { name: "Preview bids" }).click();
  await expect(
    page.getByRole("button", { name: "Import 2 bids", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Row 2 Job URL", { exact: true })
    .fill("https://example.com/two");
  await expect(
    page.getByRole("button", { name: "Import 2 bids", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove row 1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import 1 bids", exact: true }),
  ).toBeEnabled();
});

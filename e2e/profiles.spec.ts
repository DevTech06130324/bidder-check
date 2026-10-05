import { test, expect } from "@playwright/test";

test("clients manage shared candidate details separately from bidder assignments", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/profiles");
  await expect(
    page.getByRole("heading", { name: "Shared candidate profiles." }),
  ).toBeVisible();
  await expect(page.getByText("ENG-01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /ENG-01/ }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("Chicago, IL", { exact: true })).toBeVisible();
  await expect(details.getByText(/Focus on remote roles/)).toBeVisible();
  await expect(details.getByRole("heading", { name: "Jamie Parker" })).toBeVisible();
  await expect(details.getByText("bidder0@example.test", { exact: true })).toBeVisible();
  await expect(details.getByText("+1 (555) 010-2000", { exact: true })).toBeVisible();
});

test("assignment success clears the saved ID and removal clears the native picker", async ({ page }) => {
  await page.route("https://upload.example.test/**", route => route.fulfill({ status: 200, body: "{}" }));
  await page.goto("http://127.0.0.1:3001/resumes?assignment-upload");
  await page.getByRole("button", { name: "Assign profile", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Candidate profile").selectOption("profile-bidder-0");
  await dialog.getByLabel("Email address").fill("resume@example.test");
  await dialog.getByLabel("Phone number").fill("555-0100");
  const picker = dialog.getByLabel("Choose resume file");
  await picker.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fixture") });
  await dialog.getByRole("button", { name: "Assign profile and upload PDF" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Assign profile", exact: true }).click();
  await expect(dialog.locator('input[name="id"]')).toHaveValue("");
  await picker.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fixture") });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  expect(await picker.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
});

test("invalid resume files are rejected before creating an assignment", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001/resumes?assignment-upload");
  await page.evaluate(() => { document.body.dataset.saves = "0"; window.addEventListener("assignment-save", () => { document.body.dataset.saves = String(Number(document.body.dataset.saves) + 1); }); });
  await page.getByRole("button", { name: "Assign profile", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Candidate profile").selectOption("profile-bidder-0");
  await dialog.getByLabel("Email address").fill("resume@example.test");
  await dialog.getByLabel("Phone number").fill("555-0100");
  await dialog.getByLabel("Choose resume file").setInputFiles({ name: "resume.png", mimeType: "image/png", buffer: Buffer.from("invalid") });
  await dialog.getByRole("button", { name: "Assign profile and upload PDF" }).click();
  await expect(dialog.getByRole("alert")).toContainText("file type");
  await expect(page.locator("body")).toHaveAttribute("data-saves", "0");
});

test("resume assignments select a shared profile and keep contact details local", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/resumes");
  await page.getByRole("button", { name: "Assign profile", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Candidate profile")).toBeVisible();
  await expect(dialog.getByLabel("Assigned bidder")).toBeVisible();
  await expect(dialog.getByLabel("Email address")).toHaveAttribute(
    "required",
    "",
  );
  await expect(dialog.getByLabel("Phone number")).toHaveAttribute(
    "required",
    "",
  );
  await expect(dialog.getByLabel("Postal address")).toHaveCount(0);
  await expect(dialog.getByLabel("Choose resume file")).toHaveAttribute(
    "accept",
    "application/pdf",
  );
  await expect(dialog.getByLabel("Choose resume file")).toHaveAttribute(
    "required",
    "",
  );
});

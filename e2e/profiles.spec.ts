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

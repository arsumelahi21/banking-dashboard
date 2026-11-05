import { expect, test } from "@playwright/test";

// Runs against the same build with no reachable database.
const OUTAGE_URL = "http://localhost:3104";
test.use({ baseURL: OUTAGE_URL });

const TECHNICAL_DETAILS = /postgres|ECONNREFUSED|5999|Failed query|at async|node_modules/i;

test("the health check reports the problem, without details", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
});

test("the sign-in page still loads", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Explore the demo" })).toBeVisible();
});

test("trying the demo explains the problem and stays on the page", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(/can't sign you in right now/);
  await expect(page.getByRole("button", { name: "Explore the demo" })).toBeEnabled();
  expect(await page.locator("body").innerText()).not.toMatch(TECHNICAL_DETAILS);
});

test("password sign-in explains the problem, and keeps it distinct from wrong credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("a-password-here");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(/can't sign you in right now/);
});

test("a signed-in visitor sees a branded page with a way to retry, and no details", async ({ page, context }) => {
  await context.addCookies([{ name: "__Host-session", value: "any-token", domain: "localhost", path: "/", secure: true }]);
  await page.goto("/overview");

  await expect(page.getByRole("heading", { name: "We're having trouble right now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(TECHNICAL_DETAILS);
  expect(await page.content()).not.toMatch(/ECONNREFUSED|5999|Failed query/);
});

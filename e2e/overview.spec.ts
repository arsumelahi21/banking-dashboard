import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomIp, startDemo } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });

const dollars = (text: string | null) => Number(text!.replace(/[^0-9.-]/g, ""));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startDemo(page);
  await expect(page.getByRole("heading", { name: "Total cash" })).toBeVisible();
});

test("total cash equals the sum of the accounts on screen", async ({ page }) => {
  const total = dollars(await page.getByRole("heading", { name: "Total cash" }).locator("xpath=following-sibling::span").textContent());
  const rows = page.getByRole("heading", { name: "Accounts" }).locator("xpath=ancestor::section").getByRole("listitem");
  await expect(rows).toHaveCount(3);

  let sum = 0;
  for (const row of await rows.all()) {
    sum += dollars(await row.locator("div.text-right > span").first().textContent());
  }
  expect(sum).toBeCloseTo(total, 2);
});

test("the change in cash reconciles with net cash flow at every range", async ({ page }) => {
  const net = page.getByRole("heading", { name: "Net cash flow" }).locator("xpath=following-sibling::p[1]");
  const change = page.getByText(/since [A-Z][a-z]{2} \d+/).locator("xpath=preceding-sibling::span[1]");

  for (const months of [12, 6, 3]) {
    await page.getByRole("button", { name: new RegExp(`last ${months} months`) }).click();
    expect(dollars(await change.textContent())).toBeCloseTo(dollars(await net.textContent()), 2);
  }
});

test("a recent activity item opens that transaction's details", async ({ page }) => {
  const item = page.getByRole("heading", { name: "Recent activity" }).locator("xpath=ancestor::section").getByRole("link").nth(1);
  const name = await item.textContent();
  await item.click();
  await expect(page).toHaveURL(/\/transactions\?tx=/);
  await expect(page.getByRole("dialog").getByRole("heading", { name: name! })).toBeVisible();
});

test("account numbers are masked", async ({ page }) => {
  const text = await page.getByRole("heading", { name: "Accounts" }).locator("xpath=ancestor::section").textContent();
  expect(text).toContain("••4821");
  expect(text).not.toMatch(/\d{6,}/);
});

test("the time range changes every figure below it, without a page load", async ({ page }) => {
  const stat = (label: string) => page.getByRole("heading", { name: label, exact: true }).locator("xpath=following-sibling::p[1]");
  const twelveMonths = await stat("Money in").textContent();

  let navigated = false;
  page.on("framenavigated", () => {
    navigated = true;
  });
  await page.getByRole("button", { name: /last 3 months/ }).click();

  await expect(page.getByRole("button", { name: /last 3 months/ })).toHaveAttribute("aria-pressed", "true");
  await expect(stat("Money in")).not.toHaveText(twelveMonths!);
  expect(dollars(await stat("Money in").textContent())).toBeLessThan(dollars(twelveMonths));
  expect(navigated).toBe(false);
});

test("chart values can be read as a table, without hovering", async ({ page }) => {
  await page.getByText("View as table").first().click();
  const table = page.getByRole("table", { name: "Total cash by day" });
  await expect(table).toBeVisible();
  expect(await table.getByRole("row").count()).toBeGreaterThan(300);
});

test("hovering the chart shows the value for that point", async ({ page }) => {
  const chart = page.getByRole("img", { name: /Money in and money out/ });
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("Net", { exact: true })).toBeVisible();
});

test("the page has no accessibility violations in either theme, or sideways scrolling on a phone", async ({ page, context, baseURL }) => {
  for (const theme of ["light", "dark"]) {
    // A fresh load, so colors are measured at rest and not partway through a transition.
    await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Total cash" })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${theme} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  }

  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

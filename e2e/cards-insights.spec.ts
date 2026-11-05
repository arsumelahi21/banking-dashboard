import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomIp, startDemo } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });

const dollars = (text: string | null) => Number(text!.replace(/[^0-9.-]/g, ""));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startDemo(page);
});

const violationsOn = async (page: Page, label: string) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
};

async function simulate(page: Page, cardLabel: string, merchant: string, amount: string) {
  await page.getByRole("button", { name: `Simulate purchase on ${cardLabel} card` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Merchant").fill(merchant);
  await dialog.getByLabel("Amount").fill(amount);
  await dialog.getByRole("button", { name: "Simulate purchase" }).click();
  return dialog;
}

test.describe("cards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cards");
    await expect(page.getByRole("heading", { level: 1, name: "Cards" })).toBeVisible();
  });

  test("a frozen card really declines, and works again once unfrozen", async ({ page }) => {
    await page.getByRole("button", { name: "Freeze Travel card" }).click();
    await expect(page.getByRole("button", { name: "Unfreeze Travel card" })).toBeVisible();
    await expect(page.getByText("Frozen", { exact: true })).toBeVisible();

    let dialog = await simulate(page, "Travel", "Airline Tickets", "10");
    await expect(dialog.getByText("Declined", { exact: true })).toBeVisible();
    await expect(dialog.getByText("this card is frozen")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Unfreeze Travel card" }).click();
    await expect(page.getByRole("button", { name: "Freeze Travel card" })).toBeVisible();

    dialog = await simulate(page, "Travel", "Airline Tickets", "10");
    await expect(dialog.getByText("Approved", { exact: true })).toBeVisible();
  });

  test("the freeze survives a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Freeze Marketing card" }).click();
    await expect(page.getByRole("button", { name: "Unfreeze Marketing card" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Unfreeze Marketing card" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "1 frozen" })).toBeVisible();
  });

  test("a purchase over the limit is declined, and a higher limit allows it", async ({ page }) => {
    await page.getByRole("button", { name: "Edit limit for Travel card" }).click();
    await page.getByRole("dialog").getByLabel("Monthly limit").fill("100000");
    await page.getByRole("button", { name: "Save limit" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(/of \$100,000\.00/)).toBeVisible();

    const dialog = await simulate(page, "Travel", "Conference Booking", "150000");
    await expect(dialog.getByText("over this card's monthly limit")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Edit limit for Travel card" }).click();
    await page.getByRole("dialog").getByLabel("Monthly limit").fill("200000");
    await page.getByRole("button", { name: "Save limit" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const retry = await simulate(page, "Travel", "Conference Booking", "150000");
    await expect(retry.getByText("Approved", { exact: true })).toBeVisible();
  });

  for (const limit of ["0", "50", "abc", "-500", "9999999"]) {
    test(`a limit of ${limit} is refused`, async ({ page }) => {
      await page.getByRole("button", { name: "Edit limit for Founder card" }).click();
      await page.getByRole("dialog").getByLabel("Monthly limit").fill(limit);
      await page.getByRole("button", { name: "Save limit" }).click();
      await expect(page.getByText("Enter a limit between")).toBeVisible();
    });
  }

  test("a declined purchase appears in transactions as failed", async ({ page }) => {
    const merchant = `Declined Shop ${Date.now()}`;
    await page.getByRole("button", { name: "Freeze Founder card" }).click();
    await expect(page.getByRole("button", { name: "Unfreeze Founder card" })).toBeVisible();

    const dialog = await simulate(page, "Founder", merchant, "25");
    await dialog.getByRole("link", { name: "View transaction" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: merchant })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("no money moved")).toBeVisible();
  });

  test("view transactions shows only that card", async ({ page }) => {
    await page.getByRole("link", { name: "View transactions for Software card" }).click();
    await expect(page).toHaveURL(/card=[0-9a-f-]{36}/);
    await expect(page.getByRole("button", { name: /Filters\s*1/ })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Card" })).toContainText("Software");
  });

  test("full card numbers never reach the page", async ({ page }) => {
    const text = await page.locator("main").innerText();
    expect(text).toContain("•• 2207");
    expect(text).not.toMatch(/\b\d{13,19}\b/);
  });

  test("no accessibility violations in either theme, with dialogs open", async ({ page, context, baseURL }) => {
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
      await page.goto("/cards");
      await expect(page.getByRole("heading", { level: 1, name: "Cards" })).toBeVisible();
      await page.getByRole("button", { name: "Freeze Travel card" }).or(page.getByRole("button", { name: "Unfreeze Travel card" })).first().click();
      await page.waitForTimeout(400);
      expect(await violationsOn(page, `${theme} page`)).toEqual([]);

      await page.getByRole("button", { name: "Simulate purchase on Founder card" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await violationsOn(page, `${theme} dialog`)).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("insights", () => {
  const stat = (page: Page, label: string | RegExp) =>
    page.getByRole("heading", { name: label, exact: typeof label === "string" }).locator("xpath=following-sibling::p[1]");
  const rangeButton = (page: Page, months: number) => page.getByRole("button", { name: new RegExp(`last ${months} months`) });

  test.beforeEach(async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  });

  test("total spending matches Money out on the overview at every range", async ({ page }) => {
    for (const months of [3, 6, 12]) {
      await page.goto("/insights");
      await rangeButton(page, months).click();
      const spending = dollars(await stat(page, "Total spending").textContent());

      await page.goto("/overview");
      await rangeButton(page, months).click();
      const moneyOut = dollars(await stat(page, "Money out").textContent());

      expect(spending, `${months} months`).toBeCloseTo(moneyOut, 2);
    }
  });

  test("choosing a category focuses every figure, and choosing it again clears it", async ({ page }) => {
    const total = dollars(await stat(page, "Total spending").textContent());

    await page.getByRole("button", { name: /^Software/ }).click();
    const focused = dollars(await stat(page, "Software spending").textContent());
    expect(focused).toBeGreaterThan(0);
    expect(focused).toBeLessThan(total);
    await expect(page.getByRole("combobox", { name: "Category" })).toContainText("Software");
    await expect(page.getByRole("heading", { name: "Share of all spending" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Software transactions" })).toBeVisible();

    await page.getByRole("button", { name: /^Software/ }).click();
    await expect(stat(page, "Total spending")).toBeVisible();
  });

  test("category amounts add up to the total", async ({ page }) => {
    const total = dollars(await stat(page, "Total spending").textContent());
    const buttons = page.getByRole("heading", { name: "Spending by category" }).locator("xpath=ancestor::section").getByRole("listitem");
    let sum = 0;
    for (const item of await buttons.all()) {
      const text = (await item.innerText()).match(/\$[\d,]+\.\d{2}/)![0];
      sum += Math.round(dollars(text) * 100);
    }
    expect(sum / 100).toBeCloseTo(total, 2);
  });

  test("a merchant links to its transactions", async ({ page }) => {
    const section = page.getByRole("heading", { name: "Top merchants" }).locator("xpath=ancestor::section");
    const link = section.getByRole("link").first();
    const name = await link.textContent();
    await link.click();
    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(page.getByRole("searchbox", { name: "Search transactions" })).toHaveValue(name!);
    await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(name!);
  });

  test("the chart can be read as a table and hovered", async ({ page }) => {
    await page.getByText("View as table").click();
    await expect(page.getByRole("table", { name: /by month/ })).toBeVisible();
    const chart = page.getByRole("img", { name: /by month/ });
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await expect(page.locator(".recharts-tooltip-wrapper").getByText("Total spending")).toBeVisible();
  });

  test("no accessibility violations in either theme", async ({ page, context, baseURL }) => {
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Total spending", exact: true })).toBeVisible();
      expect(await violationsOn(page, theme)).toEqual([]);
    }
  });
});

test("category bars stay readable on a phone, and small shares never read as 0%", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/insights");
  await page.getByRole("button", { name: /last 12 months/ }).click();

  const bar = page.getByTestId("category-bar").first();
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.width).toBeGreaterThan(200);

  const section = page.getByRole("heading", { name: "Spending by category" }).locator("xpath=ancestor::section");
  await expect(section.getByText("<1%").first()).toBeVisible();
  await expect(section.getByText("0%", { exact: true })).toHaveCount(0);
});

test("cards and insights have no script errors or sideways scrolling on a phone", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ["/cards", "/insights"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  expect(problems).toEqual([]);
});

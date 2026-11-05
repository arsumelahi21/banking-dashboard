import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomIp, startDemo } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });

const rows = (page: Page) => page.getByRole("table").getByRole("row");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search transactions" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startDemo(page);
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
});

test.describe("search and filters", () => {
  test("search narrows results and survives a reload", async ({ page }) => {
    await search(page).fill("datadog");
    await expect(page).toHaveURL(/q=datadog/);
    await expect(rows(page).nth(1)).toContainText("Datadog");
    for (const row of await rows(page).all()) {
      if ((await row.textContent())?.includes("Amount")) continue;
      await expect(row).toContainText("Datadog");
    }

    await page.reload();
    await expect(search(page)).toHaveValue("datadog");
    await expect(rows(page).nth(1)).toContainText("Datadog");
  });

  test("a menu filter narrows results, and shows how many filters are on", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Failed" }).click();

    await expect(page).toHaveURL(/status=failed/);
    await expect(page.getByRole("button", { name: /Filters\s*1/ })).toBeVisible();
    await expect(rows(page).nth(1).getByText("Failed")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "$0.00 settled out" })).toBeVisible();
  });

  test("a filtered link opens with its filters applied", async ({ page }) => {
    await page.goto("/transactions?type=wire&direction=in");
    await expect(page.getByRole("button", { name: /Filters\s*2/ })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Type" })).toHaveText(/Wire/);
    await expect(rows(page).nth(1)).toContainText("Wire");
  });

  test("invalid URL values are ignored, not shown as an error", async ({ page }) => {
    await page.goto("/transactions?status=stolen&account=1%20or%201=1&page=-5&from=nonsense");
    await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
    await expect(rows(page).nth(1)).toBeVisible();
    await expect(page.getByRole("button", { name: /Filters\s*\d/ })).toHaveCount(0);
  });

  test("no matches gives a way back", async ({ page }) => {
    await search(page).fill("nothing-matches-this");
    await expect(page.getByText("No transactions match")).toBeVisible();
    await page.getByRole("link", { name: "Clear all filters" }).click();
    await expect(rows(page).nth(1)).toBeVisible();
    await expect(page).toHaveURL(/\/transactions$/);
  });

  test("pagination moves through results and keeps filters", async ({ page }) => {
    await page.goto("/transactions?type=card");
    const first = await rows(page).nth(1).textContent();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/type=card.*page=2/);
    await expect(rows(page).nth(1)).not.toHaveText(first!);
    await expect(page.getByText(/^26–50 of/)).toBeVisible();
    await page.getByRole("link", { name: "Previous" }).click();
    await expect(rows(page).nth(1)).toHaveText(first!);
  });
});

test.describe("transaction details", () => {
  const openFirst = async (page: Page) => {
    await rows(page).nth(1).getByRole("link").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };

  test("clicking anywhere on a row opens details, and the link can be shared", async ({ page }) => {
    // A real mouse click on the date cell, which is outside the link's own text.
    const box = (await rows(page).nth(1).getByRole("cell").first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/tx=[0-9a-f-]{36}/);

    await page.reload();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Ledger entries")).toBeVisible();
  });

  test("Escape closes the panel and returns keyboard focus to the row", async ({ page }) => {
    const link = rows(page).nth(1).getByRole("link");
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).not.toHaveURL(/tx=/);
    await expect(rows(page).nth(1).getByRole("link")).toBeFocused();
  });

  test("the browser's back button closes the panel", async ({ page }) => {
    await openFirst(page);
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  });

  test("ledger entries balance to zero", async ({ page }) => {
    await openFirst(page);
    const amounts = await page.getByRole("dialog").getByRole("listitem").locator("span.tabular-nums").allTextContents();
    expect(amounts.length).toBeGreaterThanOrEqual(2);
    const sum = amounts.reduce((total, text) => total + Math.round(Number(text.replace(/[^0-9.-]/g, "")) * 100), 0);
    expect(sum).toBe(0);
  });

  test("a saved memo persists and becomes searchable", async ({ page }) => {
    const memo = `Reviewed by finance ${Date.now()}`;
    await openFirst(page);
    await page.getByLabel("Memo").fill(memo);
    await page.getByRole("button", { name: "Save memo" }).click();
    await expect(page.getByRole("dialog").getByText("Saved", { exact: true })).toBeVisible();

    await page.goto(`/transactions?q=${encodeURIComponent(memo)}`);
    await expect(page.getByRole("status").filter({ hasText: /^1 transaction/ })).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
  });

  test("memo text can't run as code", async ({ page }) => {
    let scriptRan = false;
    page.on("dialog", async (dialog) => {
      scriptRan = true;
      await dialog.dismiss();
    });
    const attack = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

    await openFirst(page);
    await page.getByLabel("Memo").fill(attack);
    await page.getByRole("button", { name: "Save memo" }).click();
    await expect(page.getByRole("dialog").getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();

    await expect(page.getByLabel("Memo")).toHaveValue(attack);
    expect(scriptRan).toBe(false);
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  test("another customer's transaction can't be opened", async ({ page, browser }) => {
    await openFirst(page);
    const url = new URL(page.url());

    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
    const otherPage = await other.newPage();
    await startDemo(otherPage);
    await otherPage.goto(`/transactions?tx=${url.searchParams.get("tx")}`);

    await expect(otherPage.getByRole("dialog").getByText("Transaction not found")).toBeVisible();
    await expect(otherPage.getByRole("dialog").getByText("Ledger entries")).toHaveCount(0);
    await other.close();
  });
});

test.describe("CSV export", () => {
  test("downloads the filtered rows as a file, and isn't cached", async ({ page }) => {
    const response = await page.request.get("/api/transactions/export?q=datadog");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const lines = (await response.text()).trim().split("\r\n");
    expect(lines[0]).toContain("Date,Counterparty,Description");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line).toContain("Datadog");
  });

  test("the export button uses the current filters", async ({ page }) => {
    await page.goto("/transactions?status=failed");
    const href = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    expect(href).toBe("/api/transactions/export?status=failed");
  });

  test("a formula saved in a memo is neutralized in the file", async ({ page }) => {
    await rows(page).nth(1).getByRole("link").click();
    await page.getByLabel("Memo").fill('=HYPERLINK("http://evil.example")');
    await page.getByRole("button", { name: "Save memo" }).click();
    await expect(page.getByRole("dialog").getByText("Saved", { exact: true })).toBeVisible();

    const text = await (await page.request.get("/api/transactions/export")).text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
    expect(text).not.toMatch(/,"=HYPERLINK/);
  });

  test("requires a session", async ({ browser, baseURL }) => {
    const anonymous = await browser.newContext({ baseURL });
    const response = await anonymous.request.get("/api/transactions/export", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("Counterparty");
    await anonymous.close();
  });
});

test.describe("quality", () => {
  test("no accessibility violations with filters and details open, in both themes", async ({ page, context, baseURL }) => {
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
      await page.goto("/transactions?status=pending");
      await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
      let result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((v) => `${theme} list ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

      await rows(page).nth(1).getByRole("link").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((v) => `${theme} panel ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    }
  });

  test("no script errors, and no sideways scrolling on a phone", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/transactions");
    await expect(rows(page).nth(1)).toBeVisible();
    await page.getByRole("button", { name: "Filters" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await rows(page).nth(1).getByRole("link").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(problems).toEqual([]);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startDemo } from "./helpers";

const PAGES = [
  { path: "/overview", heading: "Overview" },
  { path: "/transactions", heading: "Transactions" },
  { path: "/transactions?status=failed&type=card", heading: "Transactions" },
  { path: "/payments", heading: "Payments" },
  { path: "/payments/new", heading: "New payment" },
  { path: "/cards", heading: "Cards" },
  { path: "/insights", heading: "Insights" },
];

const open = async (page: Page, path: string, heading: string) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.waitForLoadState("networkidle");
};

test.describe("every page", () => {
  for (const theme of ["light", "dark"]) {
    test(`has no accessibility violations in ${theme} mode`, async ({ page, context, baseURL }) => {
      test.setTimeout(90_000);
      await startDemo(page);
      await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
      for (const { path, heading } of PAGES) {
        await open(page, path, heading);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      }
    });
  }

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`fits a ${width}px screen with no sideways scrolling`, async ({ page }) => {
      test.setTimeout(90_000);
      await startDemo(page);
      await page.setViewportSize({ width, height: 800 });
      for (const { path, heading } of PAGES) {
        await open(page, path, heading);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("loads with no script errors, CSP violations or failed requests", async ({ page }) => {
    test.setTimeout(90_000);
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(`console: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`);
    });

    await startDemo(page);
    for (const { path, heading } of PAGES) await open(page, path, heading);
    expect(problems).toEqual([]);
  });

  test("sends security headers, stays uncached and has its own title", async ({ page }) => {
    test.setTimeout(60_000);
    await startDemo(page);
    const titles = new Set<string>();

    for (const { path, heading } of PAGES.filter((item) => !item.path.includes("?"))) {
      const response = await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      const headers = response!.headers();
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["strict-transport-security"], path).toBeTruthy();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["cache-control"], path).toContain("no-store");
      titles.add(await page.title());
    }
    expect(titles.size).toBe(PAGES.length - 1);
  });
});

test.describe("keyboard use", () => {
  test("the first Tab reaches skip to content, which moves past the navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("every focused control shows a visible focus outline", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    await page.goto("/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();

    for (let index = 0; index < 15; index += 1) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return { tag: element.tagName, text: element.textContent?.slice(0, 30), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      if (focus.tag === "BODY") continue;
      expect(focus.outline, JSON.stringify(focus)).not.toBe("none");
      expect(focus.width, JSON.stringify(focus)).toBeGreaterThan(0);
    }
  });

  test("a whole payment can be made with only the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    await page.goto("/payments/new");
    await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();

    await page.getByRole("combobox", { name: "To account" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeHidden();

    await page.getByLabel("Amount").focus();
    await page.keyboard.type("25.50");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Review your payment" })).toBeFocused();

    const confirm = page.getByRole("button", { name: "Confirm and send" });
    for (let press = 0; press < 5 && !(await confirm.evaluate((el) => el === document.activeElement)); press += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeFocused();
  });
});

test.describe("idle sign-out", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await startDemo(page);
  });

  test("warns before the timeout, and staying keeps the session", async ({ page }) => {
    await page.clock.fastForward("28:30");
    const dialog = page.getByRole("dialog", { name: "Are you still there?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Stay signed in" })).toBeFocused();

    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toBeHidden();

    await page.clock.fastForward("10:00");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  test("signs out at the timeout, and the old session no longer works", async ({ page, context }) => {
    const before = await context.cookies();
    await page.clock.fastForward("30:30");
    await expect(page).toHaveURL(/\/login$/);

    await context.addCookies(before);
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("navigating counts as activity", async ({ page }) => {
    await page.clock.fastForward("20:00");
    await page.getByRole("link", { name: "Cards" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Cards" })).toBeVisible();
    await page.clock.fastForward("20:00");
    await expect(page.getByRole("dialog", { name: "Are you still there?" })).toBeHidden();
  });
});

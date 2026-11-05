import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomIp, startDemo } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });

const dollars = (text: string | null) => Number(text!.replace(/[^0-9.-]/g, ""));

async function choose(page: Page, label: string, option: RegExp | string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

async function fillTransfer(page: Page, amount: string, memo?: string) {
  await page.goto("/payments/new");
  await choose(page, "From", /Operating/);
  await choose(page, "To account", /Reserve/);
  await page.getByLabel("Amount").fill(amount);
  if (memo) await page.getByLabel("Memo (optional)").fill(memo);
  await page.getByRole("button", { name: "Review payment" }).click();
}

const accountBalance = async (page: Page, name: string) => {
  await page.goto("/overview");
  const row = page.getByRole("heading", { name: "Accounts" }).locator("xpath=ancestor::section").getByRole("listitem").filter({ hasText: name });
  return dollars(await row.locator("div.text-right > span").first().textContent());
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startDemo(page);
});

test.describe("sending money", () => {
  test("a transfer moves the balances and appears in transactions", async ({ page }) => {
    const memo = `Test transfer ${Date.now()}`;
    const before = await accountBalance(page, "Reserve");

    await fillTransfer(page, "1,234.56", memo);
    await expect(page.getByRole("heading", { name: "Review your payment" })).toBeVisible();
    await expect(page.getByText("$1,234.56")).toBeVisible();
    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();

    expect(await accountBalance(page, "Reserve")).toBeCloseTo(before + 1234.56, 2);

    await page.goto(`/transactions?q=${encodeURIComponent(memo)}`);
    await expect(page.getByRole("status").filter({ hasText: /^1 transaction/ })).toBeVisible();
  });

  test("moves focus to each new step, for keyboard and screen reader users", async ({ page }) => {
    await fillTransfer(page, "10");
    await expect(page.getByRole("heading", { name: "Review your payment" })).toBeFocused();
    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeFocused();
  });

  test("double-clicking confirm sends once", async ({ page }) => {
    const memo = `Double click ${Date.now()}`;
    await fillTransfer(page, "50", memo);
    await page.getByRole("button", { name: "Confirm and send" }).dblclick();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();

    await page.goto(`/transactions?q=${encodeURIComponent(memo)}`);
    await expect(page.getByRole("status").filter({ hasText: /^1 transaction/ })).toBeVisible();
  });

  test("a retry after a lost response sends once", async ({ page }) => {
    const memo = `Lost response ${Date.now()}`;
    await fillTransfer(page, "75", memo);

    // The server processes the payment, but the browser never gets the answer.
    let dropped = false;
    await page.route("**/payments/new", async (route) => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true;
        await route.fetch();
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "won't send twice" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();

    await page.unroute("**/payments/new");
    await page.goto(`/transactions?q=${encodeURIComponent(memo)}`);
    await expect(page.getByRole("status").filter({ hasText: /^1 transaction/ })).toBeVisible();
  });

  test("more than the available balance is refused, with the reason on the amount", async ({ page }) => {
    await fillTransfer(page, "99,999,999");
    await expect(page.getByText("This is more than the available balance")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();
    await expect(page.getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
  });

  for (const [input, message] of [
    ["0", "Enter an amount above"],
    ["abc", "Enter an amount like"],
    ["-50", "Enter an amount like"],
    ["1.005", "Enter an amount like"],
  ] as const) {
    test(`the amount "${input}" is rejected`, async ({ page }) => {
      await fillTransfer(page, input);
      await expect(page.getByText(message)).toBeVisible();
    });
  }

  test("a destination is required", async ({ page }) => {
    await page.goto("/payments/new");
    await page.getByLabel("Amount").fill("10");
    await page.getByRole("button", { name: "Review payment" }).click();
    await expect(page.getByText("Choose where to send the money.")).toBeVisible();
  });

  test("an ACH payment holds funds, and says so", async ({ page }) => {
    await page.goto("/payments/new");
    await page.getByRole("radio", { name: "A recipient" }).check({ force: true });
    await choose(page, "To recipient", /Landmark Properties/);
    await page.getByLabel("Amount").fill("500");
    await page.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: "Confirm and send" }).click();

    await expect(page.getByRole("heading", { name: "Payment on its way" })).toBeVisible();
    await expect(page.getByText("The funds are held until then.")).toBeVisible();
    await page.getByRole("link", { name: "View transaction" }).click();
    await expect(page.getByRole("dialog").getByText("Pending")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("already reduces your available balance")).toBeVisible();
  });

  test("editing the details after review keeps nothing stale", async ({ page }) => {
    await fillTransfer(page, "20");
    await page.getByRole("button", { name: "Edit details" }).click();
    await page.getByLabel("Amount").fill("30");
    await page.getByRole("button", { name: "Review payment" }).click();
    await expect(page.getByText("$30.00")).toBeVisible();
    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();
    await expect(page.getByRole("status").getByText("$30.00")).toBeVisible();
  });
});

test.describe("verifying large payments", () => {
  const toVerify = async (page: Page) => {
    await fillTransfer(page, "10,000");
    await page.getByRole("button", { name: "Continue to verification" }).click();
    await expect(page.getByRole("heading", { name: "Verify this payment" })).toBeVisible();
    return page.getByTestId("demo-code").textContent();
  };

  test("under the threshold has no code step", async ({ page }) => {
    await fillTransfer(page, "9,999.99");
    await expect(page.getByRole("button", { name: "Confirm and send" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to verification" })).toHaveCount(0);
  });

  test("the right code sends it", async ({ page }) => {
    const code = await toVerify(page);
    await page.getByLabel("Verification code").fill(code!);
    await page.getByRole("button", { name: "Verify and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();
  });

  test("a wrong code sends nothing, and repeated wrong codes lock it", async ({ page }) => {
    const before = await accountBalance(page, "Reserve");
    const code = await toVerify(page);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel("Verification code").fill(wrong);
      await page.getByRole("button", { name: "Verify and send" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "That code isn't right" })).toBeVisible();
      await page.getByLabel("Verification code").fill("");
    }

    await page.getByLabel("Verification code").fill(code!);
    await page.getByRole("button", { name: "Verify and send" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Too many incorrect codes" })).toBeVisible();

    await page.getByRole("button", { name: "Send a new code" }).click();
    await page.getByRole("button", { name: "Continue to verification" }).click();
    const fresh = await page.getByTestId("demo-code").textContent();
    await page.getByLabel("Verification code").fill(fresh!);
    await page.getByRole("button", { name: "Verify and send" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();

    expect(await accountBalance(page, "Reserve")).toBeCloseTo(before + 10_000, 2);
  });
});

test.describe("scheduled payments", () => {
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const schedule = async (page: Page, amount: string, memo: string) => {
    await page.goto("/payments/new");
    await choose(page, "From", /Operating/);
    await choose(page, "To account", /Reserve/);
    await page.getByLabel("Amount").fill(amount);
    await page.getByLabel("Memo (optional)").fill(memo);
    await page.getByRole("radio", { name: "Schedule" }).check({ force: true });
    await page.getByLabel("Date").fill(tomorrow());
    await page.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: "Schedule payment" }).click();
    await expect(page.getByRole("heading", { name: "Payment scheduled" })).toBeVisible();
    await page.goto("/payments");
    return page.getByRole("listitem").filter({ hasText: memo });
  };

  test("scheduling moves no money, and canceling it asks first", async ({ page }) => {
    const before = await accountBalance(page, "Reserve");
    const memo = `Schedule test ${Date.now()}`;
    const row = await schedule(page, "321", memo);
    await expect(row).toBeVisible();
    expect(await accountBalance(page, "Reserve")).toBe(before);

    await page.goto("/payments");
    await row.getByRole("button", { name: /^Cancel/ }).click();
    await page.getByRole("button", { name: "Keep payment" }).click();
    await expect(row.getByText("Canceled")).toHaveCount(0);

    await row.getByRole("button", { name: /^Cancel/ }).click();
    await page.getByRole("button", { name: "Cancel payment" }).click();
    await expect(row.getByText("Canceled")).toBeVisible();
    await expect(row.getByRole("button", { name: /^Cancel/ })).toHaveCount(0);
  });

  test("send now runs it immediately, once", async ({ page }) => {
    const before = await accountBalance(page, "Reserve");
    const memo = `Send now test ${Date.now()}`;
    const row = await schedule(page, "654.32", memo);

    await row.getByRole("button", { name: /^Send/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send now" }).click();
    await expect(row.getByText("Sent", { exact: true })).toBeVisible();
    expect(await accountBalance(page, "Reserve")).toBeCloseTo(before + 654.32, 2);
  });

  test("choosing Schedule before picking a date doesn't break the page", async ({ page }) => {
    await page.goto("/payments/new");
    await page.locator("label", { hasText: /^Schedule$/ }).click();
    await expect(page.getByLabel("Date")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();
  });

  test("a large scheduled payment offers no way to send it early", async ({ page }) => {
    await page.goto("/payments");
    const large = page.getByRole("listitem").filter({ hasText: "Landmark Properties" }).filter({ hasText: "Office rent" });
    await expect(large.getByRole("button", { name: /^Cancel/ })).toBeVisible();
    await expect(large.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  });

  test("a date in the past is refused", async ({ page }) => {
    await page.goto("/payments/new");
    await choose(page, "To account", /Reserve/);
    await page.getByLabel("Amount").fill("10");
    await page.getByRole("radio", { name: "Schedule" }).check({ force: true });
    await page.getByLabel("Date").fill("2020-01-01");
    await page.getByRole("button", { name: "Review payment" }).click();
    await expect(page.getByText("Choose a date after today")).toBeVisible();
  });
});

test.describe("recipients", () => {
  test("adding one keeps only the last four digits, and it can be paid", async ({ page }) => {
    const name = `Vendor ${Date.now()}`;
    await page.goto("/payments");
    await page.getByRole("button", { name: "Add recipient" }).click();
    await page.getByLabel("Recipient name").fill(name);
    await page.getByLabel("Bank name").fill("Test Bank");
    await page.getByLabel("Account number").fill("000123456789");
    await page.getByRole("button", { name: "Save recipient" }).click();

    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toContainText("••6789");
    expect(await page.content()).not.toContain("000123456789");

    await row.getByRole("link", { name: `Pay ${name}` }).click();
    await expect(page.getByRole("combobox", { name: "To recipient" })).toContainText(name);
  });

  test("invalid details show field errors", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Add recipient" }).click();
    await page.getByLabel("Recipient name").fill("Valid Name");
    await page.getByLabel("Bank name").fill("Valid Bank");
    await page.getByLabel("Account number").fill("12ab");
    await page.getByRole("button", { name: "Save recipient" }).click();
    await expect(page.getByText("Enter 4 to 17 digits")).toBeVisible();
  });
});

test.describe("quality", () => {
  test("another customer's recipient can't be preselected through the URL", async ({ page, browser }) => {
    await page.goto("/payments");
    const href = await page.getByRole("link", { name: /^Pay / }).first().getAttribute("href");

    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
    const otherPage = await other.newPage();
    await startDemo(otherPage);
    await otherPage.goto(href!);
    await expect(otherPage.getByRole("combobox", { name: "To account" })).toBeVisible();
    await other.close();
  });

  test("no accessibility violations at any step, in either theme", async ({ page, context, baseURL }) => {
    const scan = async (label: string) => {
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    };

    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
      await page.goto("/payments");
      await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
      await scan(`${theme} payments`);

      await fillTransfer(page, "10,000");
      await expect(page.getByRole("heading", { name: "Review your payment" })).toBeVisible();
      await scan(`${theme} review`);

      await page.getByRole("button", { name: "Continue to verification" }).click();
      await expect(page.getByTestId("demo-code")).toBeVisible();
      await scan(`${theme} verify`);

      await page.getByLabel("Verification code").fill((await page.getByTestId("demo-code").textContent())!);
      await page.getByRole("button", { name: "Verify and send" }).click();
      await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();
      await scan(`${theme} receipt`);

      await page.goto("/payments/new");
      await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();
      await scan(`${theme} form`);
    }
  });

  test("no script errors, and no sideways scrolling on a phone", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of ["/payments", "/payments/new"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
    expect(problems).toEqual([]);
  });
});

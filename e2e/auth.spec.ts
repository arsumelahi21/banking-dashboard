import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomIp, startDemo } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const email = () => process.env.E2E_USER_EMAIL!;
const password = () => process.env.E2E_USER_PASSWORD!;

test.describe("access control", () => {
  for (const path of ["/overview", "/transactions", "/payments", "/cards", "/insights"]) {
    test(`${path} redirects to sign in without a session`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("a forged session cookie is rejected by the server", async ({ request }) => {
    const response = await request.get("/overview", {
      headers: { cookie: "__Host-session=forged-token" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/login");
  });
});

test.describe("password sign in", () => {
  test("works, and the session cookie is locked down", async ({ page, context }) => {
    await signIn(page, email(), password());
    await expect(page).toHaveURL(/\/overview$/);

    const cookie = (await context.cookies()).find((entry) => entry.name === "__Host-session");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("session");
  });

  test("gives the same message for a wrong password and an unknown email", async ({ page }) => {
    await signIn(page, email(), "definitely-the-wrong-password");
    const wrongPassword = await page.locator("form").getByRole("alert").textContent();

    await signIn(page, `nobody-${randomUUID()}@example.test`, "definitely-the-wrong-password");
    const unknownEmail = await page.locator("form").getByRole("alert").textContent();

    expect(wrongPassword).toBeTruthy();
    expect(unknownEmail).toBe(wrongPassword);
  });

  const attempt = async (browser: Browser, ip: string, email: string, password: string) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
    const page = await context.newPage();
    await signIn(page, email, password);
    return { page, close: () => context.close() };
  };
  const messageOf = (page: Page) => page.locator("form").getByRole("alert").textContent();

  test("blocks repeated guesses from one address", async ({ browser }) => {
    const target = `locked-${randomUUID()}@example.test`;
    const ip = randomIp();
    let last: string | null = null;
    for (let index = 0; index < 6; index += 1) {
      const { page, close } = await attempt(browser, ip, target, "a-wrong-password");
      last = await messageOf(page);
      await close();
    }
    expect(last).toContain("Too many attempts");
  });

  test("an attacker's guesses can't lock the real person out", async ({ browser }) => {
    const attackerIp = randomIp();
    for (let index = 0; index < 6; index += 1) {
      const { close, page } = await attempt(browser, attackerIp, email(), "a-wrong-password");
      await messageOf(page);
      await close();
    }

    const { page, close } = await attempt(browser, randomIp(), email(), password());
    await expect(page).toHaveURL(/\/overview$/);
    await close();
  });

  test("guessing one email from many addresses still gets blocked", async ({ browser }) => {
    test.setTimeout(90_000);
    const target = `spread-${randomUUID()}@example.test`;
    let last: string | null = null;
    for (let index = 0; index < 21; index += 1) {
      const { page, close } = await attempt(browser, randomIp(), target, "a-wrong-password");
      last = await messageOf(page);
      await close();
    }
    expect(last).toContain("Too many attempts");
  });
});

test.describe("demo workspaces", () => {
  test("sign out ends the session on the server, so a copied cookie stops working", async ({ page, context }) => {
    await startDemo(page);
    const stolen = await context.cookies();

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/login$/);

    await context.addCookies(stolen);
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("each visitor gets a separate workspace session", async ({ browser }) => {
    const [first, second] = await Promise.all([browser.newContext(), browser.newContext()]);
    const [pageA, pageB] = await Promise.all([first.newPage(), second.newPage()]);
    await startDemo(pageA);
    await startDemo(pageB);

    const tokenOf = async (context: typeof first) =>
      (await context.cookies()).find((cookie) => cookie.name === "__Host-session")?.value;
    expect(await tokenOf(first)).toBeTruthy();
    expect(await tokenOf(first)).not.toBe(await tokenOf(second));

    await first.close();
    await second.close();
  });
});

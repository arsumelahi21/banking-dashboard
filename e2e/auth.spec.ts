import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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

  test("blocks repeated guesses for one email, even from new addresses", async ({ browser }) => {
    const target = `locked-${randomUUID()}@example.test`;
    let lastMessage: string | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
      const page = await context.newPage();
      await signIn(page, target, "a-wrong-password");
      lastMessage = await page.locator("form").getByRole("alert").textContent();
      await context.close();
    }

    expect(lastMessage).toContain("Too many attempts");
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

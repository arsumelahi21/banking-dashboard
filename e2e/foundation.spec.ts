import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`app shell has no accessibility violations in ${theme} mode`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "theme", value: theme, url: baseURL! }]);
    await page.goto("/overview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  });
}

test("the design reference page is not available in production", async ({ request }) => {
  expect((await request.get("/design")).status()).toBe(404);
});

test("the theme toggle updates the page and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/overview");
  const toggle = page.getByRole("button", { name: /^Theme: system/ });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("health check reaches the database and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("pages send security headers and a unique nonce per request", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");

  const headers = first.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["x-powered-by"]).toBeUndefined();

  const nonceOf = (csp: string | undefined) => csp?.match(/'nonce-([^']+)'/)?.[1];
  const nonce = nonceOf(headers["content-security-policy"]);
  expect(nonce).toBeTruthy();
  expect(nonce).not.toBe(nonceOf(second.headers()["content-security-policy"]));
});

test("the page loads with no CSP violations or script errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(problems).toEqual([]);
});

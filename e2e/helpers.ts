import { expect, type Page } from "@playwright/test";

/** A different client address per test file, so runs don't share rate limit counters. */
export function randomIp(): string {
  const part = () => Math.floor(Math.random() * 254) + 1;
  return `10.${part()}.${part()}.${part()}`;
}

export async function startDemo(page: Page): Promise<void> {
  // Each demo looks like a new visitor, so test volume can't reach the real limit
  // of 20 demo sign-ins per hour from one address.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 30_000 });
  // The URL changes before the page finishes streaming in behind its skeleton.
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

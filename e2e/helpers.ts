import { expect, type Page } from "@playwright/test";

/** A different client address per test file, so runs don't share rate limit counters. */
export function randomIp(): string {
  const part = () => Math.floor(Math.random() * 254) + 1;
  return `10.${part()}.${part()}.${part()}`;
}

export async function startDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 30_000 });
}

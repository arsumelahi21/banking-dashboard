import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeSpend, type SpendRow } from "@/lib/insights";
import { RANGES, viewRange } from "@/lib/metrics";
import { closeDb, getDb } from "@/server/db/client";
import { accounts } from "@/server/db/schema";
import { transferBetweenAccounts } from "@/server/ledger/ledger";
import { installWorkspace } from "@/server/seed/install";
import { getSpendRows } from "./insights";
import { getOverview, type Overview } from "./overview";

const create = () =>
  getDb().transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );

describe("getSpendRows", () => {
  let org: { orgId: string; userId: string };
  let rows: SpendRow[];
  let overview: Overview;

  beforeAll(async () => {
    org = await create();
    [rows, overview] = await Promise.all([getSpendRows(getDb(), org.orgId), getOverview(getDb(), org.orgId)]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it.each(RANGES)("matches Money out on the overview, to the cent, over $label", ({ months }) => {
    const view = viewRange(overview.months, overview.daily, months);
    const summary = summarizeSpend(rows, { months: view.months.map((month) => month.month) });
    expect(summary.totalCents).toBe(view.flows.outCents);
  });

  it("matches the overview month by month", () => {
    for (const { month, outCents } of overview.months) {
      expect(summarizeSpend(rows, { months: [month] }).totalCents, month).toBe(outCents);
    }
  });

  it("only contains positive spending in whole cents", () => {
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(Number.isSafeInteger(row.cents)).toBe(true);
      expect(row.cents).toBeGreaterThan(0);
    }
  });

  it("excludes internal transfers and financing", () => {
    expect(rows.some((row) => row.category === "Internal transfer")).toBe(false);
    expect(rows.some((row) => row.category === "Financing")).toBe(false);
    expect(rows.some((row) => row.category === "Revenue")).toBe(false);
  });

  it("isn't changed by moving money between accounts", async () => {
    const db = getDb();
    const { orgId, userId } = await create();
    const owned = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
    const idOf = (name: string) => owned.find((row) => row.name === name)!.id;
    const total = (data: SpendRow[]) => data.reduce((sum, row) => sum + row.cents, 0);
    const before = total(await getSpendRows(db, orgId));

    await transferBetweenAccounts(db, {
      orgId,
      actorUserId: userId,
      fromAccountId: idOf("Operating"),
      toAccountId: idOf("Reserve"),
      amountCents: 5_000_000,
      idempotencyKey: randomUUID(),
    });

    expect(total(await getSpendRows(db, orgId))).toBe(before);
  });

  it("is empty for an organization with no data, and never mixes organizations", async () => {
    expect(await getSpendRows(getDb(), randomUUID())).toEqual([]);
  });
});

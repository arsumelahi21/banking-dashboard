import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { accounts, cards } from "@/server/db/schema";
import { cardMonthSpendCents } from "@/server/ledger/ledger";

export async function listCards(db: Db, orgId: string, now = new Date()) {
  const rows = await db
    .select({
      id: cards.id,
      label: cards.label,
      holderName: cards.holderName,
      numberLast4: cards.numberLast4,
      status: cards.status,
      monthlyLimitCents: cards.monthlyLimitCents,
      accountName: accounts.name,
    })
    .from(cards)
    .innerJoin(accounts, eq(accounts.id, cards.accountId))
    .where(eq(cards.orgId, orgId))
    .orderBy(asc(cards.label));

  return Promise.all(
    rows.map(async (card) => ({ ...card, spentCents: await cardMonthSpendCents(db, orgId, card.id, now) })),
  );
}

export type CardRow = Awaited<ReturnType<typeof listCards>>[number];

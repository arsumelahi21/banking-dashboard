import { NextResponse, type NextRequest } from "next/server";
import { csvCents, csvRow, csvText } from "@/lib/csv";
import { methodLabels, parseTransactionFilters, statusLabels } from "@/lib/transaction-filters";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { exportTransactions } from "@/server/queries/transactions";

const HEADERS = ["Date", "Counterparty", "Description", "Category", "Type", "Status", "Account", "Amount", "Currency", "Memo", "Reference"];

export async function GET(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  // A real 401, not a redirect: this is a file download, not a page.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: noStore });

  const db = getDb();
  const allowed = await consumeRateLimit(db, `export:user:${session.userId}`, { limit: 30, windowSeconds: 60 * 60 });
  if (!allowed) {
    return NextResponse.json({ error: "Too many exports. Please try again later." }, { status: 429, headers: noStore });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { tx: _openPanel, page: _page, ...filters } = parseTransactionFilters(params);
  const rows = await exportTransactions(db, session.orgId, { ...filters, page: 1 });

  await db.insert(auditLog).values({
    orgId: session.orgId,
    actorUserId: session.userId,
    action: "transactions.exported",
    metadata: { rows: rows.length },
  });

  const lines = [
    csvRow(HEADERS),
    ...rows.map((row) =>
      csvRow([
        row.occurredAt.toISOString(),
        csvText(row.counterparty),
        csvText(row.description),
        csvText(row.category),
        methodLabels[row.method],
        statusLabels[row.status],
        csvText(row.accountNames),
        csvCents(row.amountCents),
        "USD",
        csvText(row.memo),
        row.id,
      ]),
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);
  // The byte order mark tells Excel the file is UTF-8, so characters like "→" display correctly.
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      ...noStore,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${date}.csv"`,
    },
  });
}

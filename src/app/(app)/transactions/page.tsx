import { ChevronLeft, ChevronRight, Download, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TransactionStatusBadge } from "@/components/transaction-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/cn";
import { formatFullDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  methodLabels,
  parseTransactionFilters,
  serializeTransactionFilters,
  type TransactionFilters,
} from "@/lib/transaction-filters";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import {
  getTransaction,
  getTransactionFacets,
  listTransactions,
  PAGE_SIZE,
  type TransactionRow,
} from "@/server/queries/transactions";
import { TransactionDetails } from "./details";
import { TransactionFilterBar } from "./filters";

export const metadata: Metadata = { title: "Transactions" };

const hrefFor = (filters: Partial<TransactionFilters>) => {
  const query = serializeTransactionFilters(filters);
  return query ? `/transactions?${query}` : "/transactions";
};

function Row({ row, filters }: { row: TransactionRow; filters: TransactionFilters }) {
  return (
    <tr className="relative border-t border-border transition-colors first:border-t-0 hover:bg-surface-2">
      <td className="hidden py-3 pl-5 text-sm whitespace-nowrap text-fg-muted sm:table-cell">{formatFullDay(row.occurredAt)}</td>
      <td className="w-full max-w-0 py-3 pr-3 pl-5 sm:pl-4">
        {/* The link stretches over the whole row, while staying one keyboard stop. */}
        <Link
          id={`tx-${row.id}`}
          href={hrefFor({ ...filters, tx: row.id })}
          scroll={false}
          prefetch={false}
          className="block truncate rounded text-sm font-medium text-fg after:absolute after:inset-0 after:content-['']"
        >
          {row.counterparty}
        </Link>
        <p className="truncate text-xs text-fg-muted">
          <span className="sm:hidden">{formatFullDay(row.occurredAt)} · </span>
          {methodLabels[row.method]}
          {row.description !== row.counterparty ? ` · ${row.description}` : null}
        </p>
      </td>
      <td className="hidden px-4 py-3 text-sm whitespace-nowrap text-fg-muted lg:table-cell">{row.accountNames}</td>
      <td className="hidden px-4 py-3 text-sm whitespace-nowrap text-fg-muted md:table-cell">{row.category}</td>
      <td className="py-3 pr-5 pl-3 text-right whitespace-nowrap">
        <Money
          cents={row.amountCents}
          signed={row.signed}
          className={cn("text-sm", row.status === "failed" ? "text-fg-muted line-through" : "text-fg")}
        />
        {row.status !== "posted" ? (
          <div className="mt-1 flex justify-end">
            <TransactionStatusBadge status={row.status} />
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const session = await requireSession();
  const filters = parseTransactionFilters(await searchParams);
  const db = getDb();

  const [result, facets, detail] = await Promise.all([
    listTransactions(db, session.orgId, filters),
    getTransactionFacets(db, session.orgId),
    filters.tx ? getTransaction(db, session.orgId, filters.tx) : null,
  ]);

  const { tx: _open, page, ...listFilters } = filters;
  const exportQuery = serializeTransactionFilters({ ...listFilters, page: 1 });
  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const firstShown = result.rows.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = (page - 1) * PAGE_SIZE + result.rows.length;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Search and review all account activity."
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/transactions/export${exportQuery ? `?${exportQuery}` : ""}`} download>
              <Download aria-hidden />
              Export CSV
            </a>
          </Button>
        }
      />

      <TransactionFilterBar filters={filters} categories={facets.categories} accounts={facets.accounts} cards={facets.cards}>
        <p role="status" className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
          <span>
            <span className="font-medium text-fg tabular-nums">{result.total.toLocaleString("en-US")}</span>{" "}
            {result.total === 1 ? "transaction" : "transactions"}
          </span>
          <span className="tabular-nums">{formatMoney(result.inCents)} settled in</span>
          <span className="tabular-nums">{formatMoney(result.outCents)} settled out</span>
        </p>

        <Card className="overflow-hidden">
          {result.rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={result.total > 0 ? "No more results on this page" : "No transactions match"}
              description={result.total > 0 ? "Go back to the first page of results." : "Try a different search or remove a filter."}
              action={
                <Button asChild variant="secondary">
                  <Link href={result.total > 0 ? hrefFor({ ...listFilters, page: 1 }) : "/transactions"}>
                    {result.total > 0 ? "Back to first page" : "Clear all filters"}
                  </Link>
                </Button>
              }
            />
          ) : (
            <table className="w-full table-auto">
              <caption className="sr-only">Transactions, newest first. Select one to see its details.</caption>
              <thead className="border-b border-border text-left text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="hidden py-2.5 pl-5 font-medium sm:table-cell">Date</th>
                  <th scope="col" className="py-2.5 pr-3 pl-5 font-medium sm:pl-4">Transaction</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Account</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Category</th>
                  <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <Row key={row.id} row={row} filters={filters} />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {result.rows.length > 0 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted tabular-nums">
              {firstShown}–{lastShown} of {result.total.toLocaleString("en-US")}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor({ ...listFilters, page: page - 1 })} rel="prev">
                    <ChevronLeft aria-hidden />
                    Previous
                  </Link>
                </Button>
              ) : null}
              {page < lastPage ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor({ ...listFilters, page: page + 1 })} rel="next">
                    Next
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </nav>
        ) : null}
      </TransactionFilterBar>

      {filters.tx ? (
        // Keyed so reopening or switching transactions starts from a fresh, open panel.
        <TransactionDetails key={filters.tx} detail={detail} closeHref={hrefFor({ ...filters, tx: undefined })} />
      ) : null}
    </>
  );
}

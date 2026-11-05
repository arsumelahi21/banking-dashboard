"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { centsToDollarString, parseDollarsToCents } from "@/lib/money";
import {
  countActiveFilters,
  METHODS,
  methodLabels,
  serializeTransactionFilters,
  STATUSES,
  statusLabels,
  type Direction,
  type TransactionFilters,
  type TransactionMethod,
  type TransactionStatus,
} from "@/lib/transaction-filters";

const ALL = "all";
const SEARCH_DELAY_MS = 300;

type FiltersProps = {
  filters: TransactionFilters;
  categories: string[];
  accounts: { id: string; name: string }[];
  children: ReactNode;
};

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      {children}
    </label>
  );
}

/**
 * Filter changes update the URL with replace, so they don't fill the back button's
 * history. The results stay on screen, dimmed, until the new ones arrive.
 */
export function TransactionFilterBar({ filters, categories, accounts, children }: FiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const activeCount = countActiveFilters(filters);
  const [open, setOpen] = useState(activeCount > 0);
  // Text inputs are uncontrolled while typing. Clearing filters remounts them.
  const [resetVersion, setResetVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = (changes: Partial<TransactionFilters>) => {
    clearTimeout(timer.current);
    // Any new filter goes back to page 1 and closes the details panel.
    const query = serializeTransactionFilters({ ...filters, ...changes, page: 1, tx: undefined });
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  const applySoon = (changes: Partial<TransactionFilters>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(changes), SEARCH_DELAY_MS);
  };

  const fromSelect = <T extends string>(value: string) => (value === ALL ? undefined : (value as T));
  const hasAny = activeCount > 0 || Boolean(filters.q);

  return (
    <>
      <search className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              key={resetVersion}
              type="search"
              aria-label="Search transactions"
              placeholder="Search transactions"
              defaultValue={filters.q}
              maxLength={100}
              onChange={(event) => applySoon({ q: event.target.value.trim() || undefined })}
              className="pl-9"
            />
          </div>
          <Button variant="secondary" aria-expanded={open} aria-controls="transaction-filters" onClick={() => setOpen(!open)}>
            <SlidersHorizontal aria-hidden />
            Filters
            {activeCount > 0 ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent-soft-fg tabular-nums">{activeCount}</span>
            ) : null}
          </Button>
          {hasAny ? (
            <Button
              variant="ghost"
              onClick={() => {
                setResetVersion((version) => version + 1);
                apply({
                  q: undefined,
                  status: undefined,
                  method: undefined,
                  direction: undefined,
                  category: undefined,
                  accountId: undefined,
                  from: undefined,
                  to: undefined,
                  minCents: undefined,
                  maxCents: undefined,
                });
              }}
            >
              <X aria-hidden />
              Clear
            </Button>
          ) : null}
        </div>

        <div
          id="transaction-filters"
          hidden={!open}
          className={cn("grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5", open && "grid")}
        >
          <LabeledField label="Status">
            <Select
              aria-label="Status"
              value={filters.status ?? ALL}
              onValueChange={(value) => apply({ status: fromSelect<TransactionStatus>(value) })}
              options={[{ value: ALL, label: "All statuses" }, ...STATUSES.map((value) => ({ value, label: statusLabels[value] }))]}
              className="w-full"
            />
          </LabeledField>
          <LabeledField label="Type">
            <Select
              aria-label="Type"
              value={filters.method ?? ALL}
              onValueChange={(value) => apply({ method: fromSelect<TransactionMethod>(value) })}
              options={[{ value: ALL, label: "All types" }, ...METHODS.map((value) => ({ value, label: methodLabels[value] }))]}
              className="w-full"
            />
          </LabeledField>
          <LabeledField label="Direction">
            <Select
              aria-label="Direction"
              value={filters.direction ?? ALL}
              onValueChange={(value) => apply({ direction: fromSelect<Direction>(value) })}
              options={[
                { value: ALL, label: "In and out" },
                { value: "in", label: "Money in" },
                { value: "out", label: "Money out" },
              ]}
              className="w-full"
            />
          </LabeledField>
          <LabeledField label="Category">
            <Select
              aria-label="Category"
              value={filters.category ?? ALL}
              onValueChange={(value) => apply({ category: fromSelect<string>(value) })}
              options={[{ value: ALL, label: "All categories" }, ...categories.map((value) => ({ value, label: value }))]}
              className="w-full"
            />
          </LabeledField>
          <LabeledField label="Account">
            <Select
              aria-label="Account"
              value={filters.accountId ?? ALL}
              onValueChange={(value) => apply({ accountId: fromSelect<string>(value) })}
              options={[{ value: ALL, label: "All accounts" }, ...accounts.map(({ id, name }) => ({ value: id, label: name }))]}
              className="w-full"
            />
          </LabeledField>
          <LabeledField label="From date">
            <Input key={`from-${resetVersion}`} type="date" defaultValue={filters.from} onChange={(event) => apply({ from: event.target.value || undefined })} />
          </LabeledField>
          <LabeledField label="To date">
            <Input key={`to-${resetVersion}`} type="date" defaultValue={filters.to} onChange={(event) => apply({ to: event.target.value || undefined })} />
          </LabeledField>
          <LabeledField label="Minimum amount">
            <Input
              key={`min-${resetVersion}`}
              inputMode="decimal"
              placeholder="$0.00"
              defaultValue={filters.minCents === undefined ? undefined : centsToDollarString(filters.minCents)}
              onChange={(event) => applySoon({ minCents: parseDollarsToCents(event.target.value) ?? undefined })}
            />
          </LabeledField>
          <LabeledField label="Maximum amount">
            <Input
              key={`max-${resetVersion}`}
              inputMode="decimal"
              placeholder="No limit"
              defaultValue={filters.maxCents === undefined ? undefined : centsToDollarString(filters.maxCents)}
              onChange={(event) => applySoon({ maxCents: parseDollarsToCents(event.target.value) ?? undefined })}
            />
          </LabeledField>
        </div>
      </search>

      <div aria-busy={pending} className={cn("flex flex-col gap-3 transition-opacity", pending && "opacity-60")}>
        {children}
      </div>
    </>
  );
}

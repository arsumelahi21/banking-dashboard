import { parseDollarsToCents, centsToDollarString } from "@/lib/money";

export const STATUSES = ["posted", "pending", "failed"] as const;
export const METHODS = ["ach", "wire", "card", "transfer", "interest", "fee"] as const;
export const DIRECTIONS = ["in", "out"] as const;

export type TransactionStatus = (typeof STATUSES)[number];
export type TransactionMethod = (typeof METHODS)[number];
export type Direction = (typeof DIRECTIONS)[number];

export const statusLabels: Record<TransactionStatus, string> = { posted: "Settled", pending: "Pending", failed: "Failed" };
export const methodLabels: Record<TransactionMethod, string> = {
  ach: "ACH",
  wire: "Wire",
  card: "Card",
  transfer: "Transfer",
  interest: "Interest",
  fee: "Fee",
};

export type TransactionFilters = {
  q?: string;
  status?: TransactionStatus;
  method?: TransactionMethod;
  direction?: Direction;
  category?: string;
  accountId?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
  page: number;
  /** The transaction open in the details panel. */
  tx?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 60;
const MAX_PAGE = 100_000;

const oneOf = <T extends string>(options: readonly T[], value: string | undefined) =>
  options.find((option) => option === value);

/** Rejects shapes and impossible dates such as 2026-02-31, which would otherwise roll forward. */
function parseDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : undefined;
}

type RawParams = Record<string, string | string[] | undefined>;

/**
 * The URL is user input. Anything invalid is dropped rather than passed along, so
 * a bad or hand-edited link shows a wider list and never an error.
 */
export function parseTransactionFilters(params: RawParams): TransactionFilters {
  const get = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const q = get("q")?.trim().slice(0, MAX_QUERY_LENGTH);
  const category = get("category")?.trim();
  const accountId = get("account");
  const tx = get("tx");
  const page = Number(get("page"));

  let from = parseDate(get("from"));
  let to = parseDate(get("to"));
  if (from && to && from > to) [from, to] = [to, from];

  let minCents = parseDollarsToCents(get("min") ?? "") ?? undefined;
  let maxCents = parseDollarsToCents(get("max") ?? "") ?? undefined;
  if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
    [minCents, maxCents] = [maxCents, minCents];
  }

  return {
    q: q || undefined,
    status: oneOf(STATUSES, get("status")),
    method: oneOf(METHODS, get("type")),
    direction: oneOf(DIRECTIONS, get("direction")),
    category: category && category.length <= MAX_CATEGORY_LENGTH ? category : undefined,
    accountId: accountId && UUID.test(accountId) ? accountId : undefined,
    from,
    to,
    minCents,
    maxCents,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
    tx: tx && UUID.test(tx) ? tx : undefined,
  };
}

/** Builds a query string. Empty values and the default page are left out, to keep links short. */
export function serializeTransactionFilters(filters: Partial<TransactionFilters>): string {
  const query = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ["q", filters.q],
    ["status", filters.status],
    ["type", filters.method],
    ["direction", filters.direction],
    ["category", filters.category],
    ["account", filters.accountId],
    ["from", filters.from],
    ["to", filters.to],
    ["min", filters.minCents === undefined ? undefined : centsToDollarString(filters.minCents)],
    ["max", filters.maxCents === undefined ? undefined : centsToDollarString(filters.maxCents)],
    ["page", filters.page && filters.page > 1 ? String(filters.page) : undefined],
    ["tx", filters.tx],
  ];
  for (const [key, value] of entries) {
    if (value) query.set(key, value);
  }
  return query.toString();
}

/** How many narrowing filters are on. Search has its own visible box, so it isn't counted. */
export function countActiveFilters(filters: TransactionFilters): number {
  return [
    filters.status,
    filters.method,
    filters.direction,
    filters.category,
    filters.accountId,
    filters.from,
    filters.to,
    filters.minCents,
    filters.maxCents,
  ].filter((value) => value !== undefined).length;
}

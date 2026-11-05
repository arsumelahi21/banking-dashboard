/**
 * All money in the app is an integer number of minor units (cents). Floats are
 * only used at the last moment, for display, where rounding can't accumulate.
 */
export type Cents = number;

type FormatOptions = {
  currency?: string;
  /** Show "+" on positive amounts, for inflows. */
  signed?: boolean;
  /** Shorten large values for chart axes, e.g. "$1.2M". */
  compact?: boolean;
};

export function formatMoney(
  cents: Cents,
  { currency = "USD", signed = false, compact = false }: FormatOptions = {},
): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be a whole number of cents, got ${cents}`);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    signDisplay: signed ? "exceptZero" : "auto",
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  }).format(cents / 100);
}

/** "1234.50" for 123450 cents. For form fields and URLs, where symbols would get in the way. */
export function centsToDollarString(cents: Cents): string {
  const absolute = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

const DOLLARS = /^\$?\s*(\d{1,12})(?:\.(\d{1,2}))?$/;

/**
 * Reads what a person typed into whole cents, working on the text so no floating
 * point is involved. Returns null for anything that isn't a plain positive amount.
 */
export function parseDollarsToCents(input: string): Cents | null {
  const match = DOLLARS.exec(input.trim().replaceAll(",", ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

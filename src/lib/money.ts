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

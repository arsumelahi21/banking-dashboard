import { centsToDollarString } from "@/lib/money";

/**
 * Spreadsheets run a cell as a formula when it starts with one of these. A memo
 * such as =HYPERLINK(...) could otherwise execute when someone opens the export.
 * Leading whitespace is included because spreadsheets can ignore it when importing.
 */
const FORMULA_START = /^[\s]*[=+\-@\t\r]/;

/** A value from a person or a merchant. Neutralized, then quoted per RFC 4180. */
export function csvText(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A number we produced ourselves, so a leading minus is a real negative and stays. */
export function csvCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  return centsToDollarString(cents);
}

export function csvRow(cells: string[]): string {
  return cells.join(",");
}

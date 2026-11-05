/**
 * Dates use UTC everywhere, so the server and browser always render the same
 * text and a transaction never appears to move between days.
 */
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const fullDayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
const fullMonthFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** Accepts a Date, or a "YYYY-MM-DD" / "YYYY-MM" key. */
const toDate = (value: Date | string) => (typeof value === "string" ? new Date(`${value.padEnd(10, "-01")}T00:00:00Z`) : value);

export const formatDay = (value: Date | string) => dayFormat.format(toDate(value));
export const formatFullDay = (value: Date | string) => fullDayFormat.format(toDate(value));
export const formatMonth = (value: Date | string) => monthFormat.format(toDate(value));
export const formatFullMonth = (value: Date | string) => fullMonthFormat.format(toDate(value));

import { cn } from "@/lib/cn";
import { formatMoney, type Cents } from "@/lib/money";

type MoneyProps = {
  cents: Cents;
  currency?: string;
  /** Show the sign and color inflows green. Outflows stay neutral: spending isn't an error. */
  signed?: boolean;
  /** Large serif style for headline balances. */
  display?: boolean;
  className?: string;
};

export function Money({ cents, currency, signed = false, display = false, className }: MoneyProps) {
  return (
    <span
      className={cn(
        display ? "font-display tracking-wide" : "tabular-nums",
        signed && cents > 0 && "text-positive",
        className,
      )}
    >
      {formatMoney(cents, { currency, signed })}
    </span>
  );
}

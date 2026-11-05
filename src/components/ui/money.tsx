import { cn } from "@/lib/cn";
import { formatMoney, type Cents } from "@/lib/money";

type MoneyProps = {
  cents: Cents;
  currency?: string;
  /** Show the sign and color inflows green. Outflows stay neutral: spending isn't an error. */
  signed?: boolean;
  /** Headline style. Proportional digits, because this number stands alone instead of aligning in a column. */
  display?: boolean;
  className?: string;
};

export function Money({ cents, currency, signed = false, display = false, className }: MoneyProps) {
  return (
    <span
      className={cn(
        display ? "font-semibold tracking-tight" : "tabular-nums",
        signed && cents > 0 && "text-positive",
        className,
      )}
    >
      {formatMoney(cents, { currency, signed })}
    </span>
  );
}

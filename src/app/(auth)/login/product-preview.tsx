const activity = [
  { name: "Halcyon Health", detail: "Invoice payment", amount: "+$38,420.00", incoming: true },
  { name: "Amazon Web Services", detail: "Card", amount: "-$6,888.01", incoming: false },
  { name: "Operating to Reserve", detail: "Transfer", amount: "$50,000.00", incoming: false },
];

const LINE = "M0 58 L28 52 L56 55 L84 44 L112 47 L140 36 L168 40 L196 28 L224 31 L252 20 L280 12";

/**
 * A drawn illustration of the product, so the sign-in page shows what's inside. It's
 * decorative and repeats nothing a person needs, so it's hidden from screen readers.
 */
export function ProductPreview() {
  return (
    <aside aria-hidden className="relative hidden flex-col justify-center gap-10 overflow-hidden bg-[#0d3d33] p-16 text-white lg:flex">
      <div className="flex max-w-md flex-col gap-3">
        <p className="font-display text-3xl leading-tight font-bold">Know where your money stands, at a glance.</p>
        <p className="text-sm leading-relaxed text-white/70">Balances from a real double-entry ledger, safeguards on every payment, and clear answers about where it all goes.</p>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-[#1a1c1a] shadow-2xl">
        <p className="text-sm text-[#5f625c]">Total cash</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">$1,844,597.22</p>
        <p className="mt-1 text-xs text-[#5f625c]">+$97,851.67 since Dec 1</p>

        <svg viewBox="0 0 280 70" className="mt-4 h-20 w-full" preserveAspectRatio="none" fill="none">
          <path d={`${LINE} L280 70 L0 70 Z`} fill="#00806a" fillOpacity="0.1" />
          <path d={LINE} stroke="#00806a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        <ul className="mt-4 flex flex-col divide-y divide-[#e3e0d8] border-t border-[#e3e0d8]">
          {activity.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-[#5f625c]">{item.detail}</p>
              </div>
              <p className={`text-sm tabular-nums ${item.incoming ? "text-[#146c43]" : ""}`}>{item.amount}</p>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

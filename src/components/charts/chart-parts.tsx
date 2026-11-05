import type { ReactNode } from "react";

export type TooltipRow = { label: string; value: string; color?: string };

/** The value leads, because the reader already knows the series and wants the number. */
export function ChartTooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-overlay">
      <p className="mb-1 text-fg-muted">{title}</p>
      <dl className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            {row.color ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: row.color }} /> : null}
            <dd className="font-semibold text-fg tabular-nums">{row.value}</dd>
            <dt className="text-fg-muted">{row.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Every chart's values are also readable as text, without hovering or seeing color. */
export function ChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="w-fit cursor-pointer rounded text-xs text-fg-muted hover:text-fg">View as table</summary>
      <div className="mt-2 max-h-64 overflow-auto" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface text-fg-muted">
            <tr>
              {headers.map((header, index) => (
                <th key={header} scope="col" className={index === 0 ? "py-1.5 font-medium" : "py-1.5 text-right font-medium"}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                {row.cells.map((cell, index) => (
                  <td key={index} className={index === 0 ? "py-1.5 text-fg-muted" : "py-1.5 text-right text-fg tabular-nums"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

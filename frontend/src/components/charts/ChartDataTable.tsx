type ChartCell = string | number | null | undefined;

interface ChartDataTableProps {
  title: string;
  summary: string;
  columns: { key: string; label: string }[];
  rows: Record<string, ChartCell>[];
  /** Limits visual table height without hiding rows from keyboard users. */
  className?: string;
}

/**
 * A semantic alternative for canvas and SVG charts. Native <details> makes
 * it discoverable and keyboard-operable without duplicating dense data by
 * default, while the table gives screen readers the same values as sighted
 * chart users.
 */
export function ChartDataTable({ title, summary, columns, rows, className }: ChartDataTableProps) {
  return (
    <details className={className}>
      <summary className="focus-ring cursor-pointer rounded px-1 py-1 text-xs font-medium text-[var(--color-accent-blue)] hover:text-[var(--color-text-bright)]">
        View {title} data table
        <span className="sr-only">. {summary}</span>
      </summary>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{summary}</p>
      <div className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border-default)]">
        <table className="w-full min-w-max text-left text-xs">
          <caption className="sr-only">{title} data</caption>
          <thead className="sticky top-0 bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
            <tr>
              {columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{column.label}</th>)}
            </tr>
          </thead>
          <tbody className="tnum divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
            {rows.map((row, index) => (
              <tr key={`${index}-${String(row[columns[0]?.key] ?? "row")}`}>
                {columns.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2">{row[column.key] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

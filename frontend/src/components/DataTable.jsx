/**
 * Neutral data table — uses surface/background tokens, not brand colors.
 */
export default function DataTable({
  columns,
  rows,
  empty = "No data for this range.",
  minWidth = "480px",
  className = "",
  rowClassName = "",
  getRowKey,
}) {
  if (!rows?.length) {
    return <p className="text-sm text-[var(--bl-muted-text)] py-6 text-center">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className={`bl-data-table text-sm ${className}`.trim()} style={{ minWidth }}>
        <thead className="bl-data-table-head">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 ${c.right ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey ? getRowKey(row, i) : row.id ?? row.key ?? row.name ?? row.label ?? i}
              className={rowClassName}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 ${c.right ? "text-right tabular-nums" : ""}`}
                >
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

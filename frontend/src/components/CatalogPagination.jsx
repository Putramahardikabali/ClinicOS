import { ChevronLeft, ChevronRight } from "lucide-react";

export default function CatalogPagination({ page, pages, total, pageSize, onPage, loading, label = "item", testIdPrefix = "catalog" }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const plural = total === 1 ? label : `${label}s`;

  return (
    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3" data-testid={`${testIdPrefix}-pagination`}>
      <div className="text-sm text-[#5C6C62]">
        Showing {from}–{to} of {total.toLocaleString()} {plural}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={loading || page <= 1}
          className="bl-btn-ghost inline-flex items-center gap-1 text-sm disabled:opacity-40"
          data-testid={`${testIdPrefix}-prev-page`}
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <span className="text-sm text-[#2D3A33] px-2 tabular-nums" data-testid={`${testIdPrefix}-page-indicator`}>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={loading || page >= pages}
          className="bl-btn-ghost inline-flex items-center gap-1 text-sm disabled:opacity-40"
          data-testid={`${testIdPrefix}-next-page`}
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

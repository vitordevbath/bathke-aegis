type PageItem = number | 'gap';

/** First, last, current ±1, with gaps — never hundreds of buttons. */
export function pageWindow(page: number, totalPages: number): PageItem[] {
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((value, index) => {
    const previous = sorted[index - 1];
    return previous !== undefined && value - previous > 1 ? (['gap', value] as PageItem[]) : [value];
  });
}

interface PaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
  readonly disabled?: boolean;
}

/** Reusable pager for any `PaginatedResponse`. Renders nothing for a single page. */
export function Pagination({ page, totalPages, onPageChange, disabled = false }: PaginationProps) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(page, 1), totalPages);

  return (
    <nav className="pagination" aria-label="Paginação">
      <button type="button" className="button button--ghost" disabled={disabled || current <= 1} onClick={() => onPageChange(current - 1)}>
        Anterior
      </button>
      <ol className="pagination__pages">
        {pageWindow(current, totalPages).map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} className="pagination__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={item === current ? 'pagination__page pagination__page--current' : 'pagination__page'}
                aria-current={item === current ? 'page' : undefined}
                aria-label={`Página ${item}`}
                disabled={disabled}
                onClick={() => item !== current && onPageChange(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>
      <button
        type="button"
        className="button button--ghost"
        disabled={disabled || current >= totalPages}
        onClick={() => onPageChange(current + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}

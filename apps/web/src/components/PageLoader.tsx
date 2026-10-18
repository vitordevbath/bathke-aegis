export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="page-loader__bar" />
      <span className="visually-hidden">Carregando…</span>
    </div>
  );
}

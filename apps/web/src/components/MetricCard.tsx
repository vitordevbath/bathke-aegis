export function MetricCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="surface metric">
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
      {hint && <span className="metric__hint">{hint}</span>}
    </div>
  );
}

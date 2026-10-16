export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface metric">
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
    </div>
  );
}

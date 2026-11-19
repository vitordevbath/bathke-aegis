import { Link } from 'react-router-dom';

interface MetricCardProps {
  readonly label: string;
  readonly value: number | string;
  readonly hint?: string | undefined;
  /** Colors the hint when the number asks for attention. */
  readonly tone?: 'warn' | 'danger' | undefined;
  /** When set, the whole card links to the screen behind the number. */
  readonly to?: string | undefined;
}

export function MetricCard({ label, value, hint, tone, to }: MetricCardProps) {
  const body = (
    <>
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
      {hint && <span className={`metric__hint${tone ? ` metric__hint--${tone}` : ''}`}>{hint}</span>}
    </>
  );
  return to ? (
    <Link className="surface metric metric--link" to={to}>
      {body}
    </Link>
  ) : (
    <div className="surface metric">{body}</div>
  );
}

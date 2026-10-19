import type { Severity } from '@aegis/domain';
import { SEVERITY_LABELS, SEVERITY_LEVEL } from '../lib/severity';

/** Text label plus 1–4 bars: severity is never conveyed by color alone. Shared by rules and incidents. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const level = SEVERITY_LEVEL[severity];
  return (
    <span className={`severity severity--${severity.toLowerCase()}`}>
      <span className="severity__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span key={bar} className={bar <= level ? 'severity__bar severity__bar--on' : 'severity__bar'} />
        ))}
      </span>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

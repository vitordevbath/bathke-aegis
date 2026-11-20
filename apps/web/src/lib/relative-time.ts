const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always', style: 'long' });
const absolute = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "agora", "há 3 minutos", "há 2 horas", "há 4 dias"; past one week, the absolute date.
 * Used where recency matters more than the exact instant (last contact, latest events).
 * A timestamp slightly in the future (clock skew) reads as "agora".
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - Date.parse(iso);
  if (Number.isNaN(elapsed)) return '—';
  if (elapsed < MINUTE) return 'agora';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');
  return absolute.format(new Date(iso));
}

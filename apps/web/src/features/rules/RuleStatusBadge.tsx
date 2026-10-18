/** "Habilitada" means ready for the future detection engine — not "running". */
export function RuleStatusBadge({ enabled }: { enabled: boolean }) {
  return <span className={enabled ? 'rule-status rule-status--on' : 'rule-status'}>{enabled ? 'Habilitada' : 'Desabilitada'}</span>;
}

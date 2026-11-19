import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventSummary, IncidentTimelineResponse } from '@aegis/contracts';
import { INCIDENT_TIMELINE_LIMITS } from '@aegis/domain';
import { SEVERITY_LABELS } from '../../../lib/severity';
import { TYPE_LABELS } from '../../events/event-labels';
import { activityActor, buildTimelineRows, describeActivity, TIMELINE_FILTERS, type TimelineEntry, type TimelineFilter } from './timeline-model';

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const time = (iso: string) => clock.format(new Date(iso));
const PADDING_MINUTES = INCIDENT_TIMELINE_LIMITS.contextPaddingMs / 60_000;

function ContextEvent({ event }: { readonly event: EventSummary }) {
  return (
    <li className="tl-item tl-item--context">
      <time className="tl-time mono" dateTime={event.occurredAt}>
        {time(event.occurredAt)}
      </time>
      <span className="tl-mark" aria-hidden="true" />
      <div className="tl-body">
        <Link className="tl-title tl-title--quiet" to={`/eventos/${event.id}`}>
          {event.summary}
        </Link>
        <p className="tl-meta">
          {TYPE_LABELS[event.type]} · {event.hostDisplayName}
        </p>
      </div>
    </li>
  );
}

function Entry({ entry }: { readonly entry: TimelineEntry }) {
  if (entry.kind === 'context') return <ContextEvent event={entry.event} />;
  if (entry.kind === 'boundary') {
    return (
      <li className="tl-boundary">
        <span className="tl-boundary__label">
          {entry.boundary === 'window-start'
            ? `Eventos ao redor a partir daqui · ${PADDING_MINUTES} min antes da primeira ocorrência`
            : 'Incidente resolvido · fim da janela de eventos'}
        </span>
      </li>
    );
  }
  if (entry.kind === 'alert') {
    const { alert } = entry;
    return (
      <li className={`tl-item tl-item--alert tl-item--${alert.severity.toLowerCase()}`}>
        <time className="tl-time mono" dateTime={alert.occurredAt}>
          {time(alert.occurredAt)}
        </time>
        <span className="tl-mark" aria-hidden="true" />
        <div className="tl-body">
          <Link className="tl-title" to={`/alertas/${alert.id}`}>
            {alert.event.summary}
          </Link>
          <p className="tl-meta">
            <span className="tl-tag">Alerta · {SEVERITY_LABELS[alert.severity]}</span> {alert.rule.name} · {alert.host.displayName}
          </p>
        </div>
      </li>
    );
  }
  const { activity } = entry;
  const deletedInvestigation = activity.investigation?.id === null;
  return (
    <li className="tl-item tl-item--history">
      <time className="tl-time mono" dateTime={activity.createdAt}>
        {time(activity.createdAt)}
      </time>
      <span className="tl-mark" aria-hidden="true" />
      <div className="tl-body">
        {activity.investigation?.id ? (
          <Link className="tl-title" to={`/investigacoes/${activity.investigation.id}`}>
            {describeActivity(activity)}
          </Link>
        ) : (
          <p className="tl-title">{describeActivity(activity)}</p>
        )}
        <p className="tl-meta">
          {activityActor(activity)}
          {deletedInvestigation && ' · investigação excluída depois'}
        </p>
      </div>
    </li>
  );
}

function ContextRun({ events }: { readonly events: readonly EventSummary[] }) {
  const [open, setOpen] = useState(false);
  const first = events[0];
  const last = events.at(-1);
  if (open) return events.map((event) => <ContextEvent key={event.id} event={event} />);
  return (
    <li className="tl-item tl-item--run">
      <time className="tl-time mono" dateTime={first?.occurredAt}>
        {first ? time(first.occurredAt) : ''}
      </time>
      <span className="tl-mark" aria-hidden="true" />
      <div className="tl-body">
        <button type="button" className="tl-run" aria-expanded="false" onClick={() => setOpen(true)}>
          {events.length} eventos dos hosts envolvidos
          {last && first && last.occurredAt !== first.occurredAt ? ` até ${time(last.occurredAt)}` : ''} · mostrar
        </button>
      </div>
    </li>
  );
}

/**
 * The incident reconstructed in order (ADR-054): its history, the alerts that fed it and, folded by
 * default, what else the involved hosts reported around it.
 */
export function IncidentTimeline({ timeline }: { readonly timeline: IncidentTimelineResponse }) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const rows = useMemo(() => buildTimelineRows(timeline, filter), [timeline, filter]);
  const counts: Record<TimelineFilter, number> = {
    all: timeline.activities.length + timeline.alerts.length + timeline.context.length,
    alerts: timeline.alerts.length,
    history: timeline.activities.length,
    context: timeline.context.length,
  };
  const empty = rows.every((row) => row.type === 'day' || (row.type === 'entry' && row.entry.kind === 'boundary'));

  return (
    <div className="timeline">
      <div className="chip-group" role="group" aria-label="Mostrar na linha do tempo">
        {TIMELINE_FILTERS.map((option) => (
          <button key={option.value} type="button" className="chip" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}
            <span className="chip__count">{counts[option.value]}</span>
          </button>
        ))}
      </div>

      {empty ? (
        <p className="muted small">
          {filter === 'alerts' ? 'Nenhum alerta foi correlacionado a este incidente.' : 'Nada registrado nesta visão ainda.'}
        </p>
      ) : (
        <ol className="tl">
          {rows.map((row) =>
            row.type === 'day' ? (
              <li key={row.id} className="tl-day">
                {row.label}
              </li>
            ) : row.type === 'context-run' ? (
              <ContextRun key={row.id} events={row.events} />
            ) : (
              <Entry key={row.entry.id} entry={row.entry} />
            ),
          )}
        </ol>
      )}

      {(timeline.alertsTruncated || timeline.contextTruncated) && (
        <p className="muted small">
          {timeline.alertsTruncated && `Mostrando os primeiros ${INCIDENT_TIMELINE_LIMITS.alerts} alertas. `}
          {timeline.contextTruncated && `Mostrando os primeiros ${INCIDENT_TIMELINE_LIMITS.contextEvents} eventos ao redor; o restante está em Eventos.`}
        </p>
      )}
    </div>
  );
}

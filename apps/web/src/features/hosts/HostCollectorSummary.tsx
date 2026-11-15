import { Link } from 'react-router-dom';
import { HOST_PRESENCE_POLICY, type HostResponse } from '@aegis/contracts';
import { useEventList } from '../events/events-api';
import { CONNECTION_STATE_HINTS, CONNECTION_STATE_LABELS, formatDateTime } from './host-format';
import { HOST_REFRESH_MS } from './hosts-api';

const NOT_REPORTED = 'Não informado pelo Collector';
const seconds = (ms: number) => Math.round(ms / 1000);

/**
 * What the platform knows about this host's Collector, from server facts only:
 * the derived connection state, the last heartbeat (server clock) and the
 * events actually stored. Refreshed periodically while the screen is open.
 */
export function HostCollectorSummary({ workspaceId, host }: { readonly workspaceId: string; readonly host: HostResponse }) {
  const events = useEventList(workspaceId, { page: 1, pageSize: 1, hostId: host.id }, { refetchInterval: HOST_REFRESH_MS });
  const latest = events.data?.items[0];
  const os = [host.osName, host.osVersion].filter(Boolean).join(' ');

  return (
    <section className="surface" aria-labelledby="collector-title">
      <h2 id="collector-title" className="section-title">
        Collector e telemetria
      </h2>
      <p className="muted small">
        Dados informados pelo Aegis Collector e registrados pelo servidor; não podem ser editados. O Collector envia um heartbeat a cada{' '}
        {seconds(HOST_PRESENCE_POLICY.heartbeatIntervalMs)} s; sem heartbeat por {seconds(HOST_PRESENCE_POLICY.onlineWindowMs)} s, o host passa a Offline.
      </p>
      <dl className="facts">
        <div>
          <dt>Comunicação</dt>
          <dd>{CONNECTION_STATE_LABELS[host.connectionState]}</dd>
        </div>
        <div>
          <dt>Último heartbeat</dt>
          <dd>{host.lastSeenAt ? formatDateTime(host.lastSeenAt) : 'Nunca'}</dd>
        </div>
        <div>
          <dt>Eventos recebidos</dt>
          <dd>
            {events.isError ? 'Indisponível agora' : !events.data ? 'Carregando…' : events.data.pagination.total}
            {latest && <span className="muted small"> · último ocorrido em {formatDateTime(latest.occurredAt)}</span>}
          </dd>
        </div>
        <div>
          <dt>Hostname</dt>
          <dd>{host.hostname ?? NOT_REPORTED}</dd>
        </div>
        <div>
          <dt>Sistema operacional</dt>
          <dd>{os || NOT_REPORTED}</dd>
        </div>
        <div>
          <dt>Arquitetura</dt>
          <dd>{host.architecture ?? NOT_REPORTED}</dd>
        </div>
      </dl>
      <p className="muted small facts-note">{CONNECTION_STATE_HINTS[host.connectionState]}</p>
      {events.data && events.data.pagination.total > 0 && (
        <p className="small facts-note">
          <Link className="inline-link" to={`/eventos?hostId=${encodeURIComponent(host.id)}`}>
            Ver eventos deste host
          </Link>
        </p>
      )}
    </section>
  );
}

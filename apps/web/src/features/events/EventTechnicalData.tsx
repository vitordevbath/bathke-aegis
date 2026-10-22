import type { EventBodyV1 } from '@aegis/contracts';
import { SERVICE_STATE_LABELS, SYSTEM_KIND_LABELS } from './event-labels';

const NOT_INFORMED = 'Não informado';

type Fact = readonly [label: string, value: string | number | null];

const endpoint = (address: string | null, port: number | null) => (address === null && port === null ? null : `${address ?? '*'}:${port ?? '*'}`);

/** Labelled fields per category, straight from the stored event. Missing values are said to be missing, never invented. */
function factsOf(event: EventBodyV1): Fact[] {
  switch (event.category) {
    case 'PROCESS': {
      const process = event.data.process;
      return [
        ['PID', process.pid],
        ['Parent PID', process.parentPid],
        ['Nome', process.name],
        ['Executável', process.executable],
        ['Processo pai', process.parentName],
        ['Usuário', process.user],
      ];
    }
    case 'NETWORK': {
      const network = event.data.network;
      return [
        ['Protocolo', network.protocol],
        ['Endereço/porta local', endpoint(network.localAddress, network.localPort)],
        ['Endereço/porta remota', endpoint(network.remoteAddress, network.remotePort)],
        ['PID', network.pid],
        ['Processo', network.processName],
      ];
    }
    case 'SYSTEM': {
      const system = event.data.system;
      return [
        ['Tipo', SYSTEM_KIND_LABELS[system.eventType]],
        ['Serviço', system.serviceName],
        ['Estado', system.state ? SERVICE_STATE_LABELS[system.state] : null],
      ];
    }
  }
}

export function EventTechnicalData({ event }: { event: EventBodyV1 }) {
  return (
    <dl className="facts">
      {factsOf(event).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={value === null ? 'muted' : 'mono'}>{value === null ? NOT_INFORMED : value}</dd>
        </div>
      ))}
    </dl>
  );
}

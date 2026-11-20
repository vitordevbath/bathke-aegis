import { useScrollProgress } from './motion';

const INCIDENTS = [
  { severity: 'critical', label: 'Crítica', title: 'Boot inesperado em srv-db-01', status: 'Aberto' },
  { severity: 'high', label: 'Alta', title: 'sshd reiniciado fora da janela de manutenção', status: 'Em investigação' },
  { severity: 'low', label: 'Baixa', title: 'Pareamento de VM de laboratório', status: 'Aberto' },
] as const;

const HOSTS = [
  { name: 'srv-db-01', state: 'offline', seen: 'há 4 minutos' },
  { name: 'fedora-notebook', state: 'online', seen: 'agora' },
  { name: 'srv-web-01', state: 'online', seen: 'agora' },
] as const;

/**
 * A rendering of the real dashboard layout with sample data, tilted back in perspective and
 * settling flat as it scrolls into view. Purely illustrative: one accessible description, the
 * markup inside is hidden from assistive technology and contains no links.
 */
export function ProductPreview() {
  const ref = useScrollProgress<HTMLDivElement>(0.3);

  return (
    <figure className="lp-preview">
      <div ref={ref} className="lp-preview__stage">
        <div
          className="lp-preview__frame"
          role="img"
          aria-label="Prévia do painel do Aegis com dados de exemplo: incidentes que precisam de atenção e a comunicação de cada host."
        >
          <div className="lp-preview__screen" aria-hidden="true">
            <div className="pv-bar">
              <span className="pv-bar__brand">AEGIS</span>
              <span className="pv-bar__item pv-bar__item--on">Painel</span>
              <span className="pv-bar__item">Hosts</span>
              <span className="pv-bar__item">Eventos</span>
              <span className="pv-bar__item">Incidentes</span>
              <span className="pv-bar__avatar">VB</span>
            </div>
            <div className="pv-body">
              <p className="pv-hello">Olá, Vitor</p>
              <div className="pv-kpis">
                <div className="pv-kpi">
                  <span>Hosts online</span>
                  <strong>2/3</strong>
                  <em className="pv-warn">1 sem comunicação</em>
                </div>
                <div className="pv-kpi">
                  <span>Incidentes ativos</span>
                  <strong>3</strong>
                  <em className="pv-danger">1 crítico</em>
                </div>
                <div className="pv-kpi">
                  <span>Investigações</span>
                  <strong>1</strong>
                  <em>em andamento</em>
                </div>
                <div className="pv-kpi">
                  <span>Eventos</span>
                  <strong>1.284</strong>
                  <em>último agora</em>
                </div>
              </div>
              <div className="pv-panels">
                <div className="pv-panel">
                  <p className="pv-panel__title">Precisa de atenção</p>
                  {INCIDENTS.map((incident) => (
                    <div key={incident.title} className="pv-row">
                      <span className={`pv-sev pv-sev--${incident.severity}`}>{incident.label}</span>
                      <span className="pv-row__title">{incident.title}</span>
                      <span className="pv-row__status">{incident.status}</span>
                    </div>
                  ))}
                </div>
                <div className="pv-panel">
                  <p className="pv-panel__title">Hosts</p>
                  {HOSTS.map((host) => (
                    <div key={host.name} className="pv-row">
                      <span className="pv-row__title">{host.name}</span>
                      <span className="pv-row__status">{host.seen}</span>
                      <span className={`pv-dot pv-dot--${host.state}`} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="lp-preview__caption">O painel começa pelo que precisa de atenção. Dados de exemplo.</figcaption>
    </figure>
  );
}

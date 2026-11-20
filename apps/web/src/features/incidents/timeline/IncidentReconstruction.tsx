import { useRef, useState, type KeyboardEvent } from 'react';
import { useIncidentTimeline } from './timeline-api';
import { IncidentTimeline } from './IncidentTimeline';
import { IncidentGraph } from './IncidentGraph';

const VIEWS = [
  { id: 'timeline', label: 'Linha do tempo' },
  { id: 'graph', label: 'Relações' },
] as const;
type View = (typeof VIEWS)[number]['id'];

/** Two readings of the same data: in order of time, or in order of cause. One request feeds both. */
export function IncidentReconstruction({ workspaceId, incidentId }: { readonly workspaceId: string; readonly incidentId: string }) {
  const timeline = useIncidentTimeline(workspaceId, incidentId);
  const [view, setView] = useState<View>('timeline');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next]?.id ?? 'timeline');
    tabs.current[next]?.focus();
  };

  return (
    <section className="surface reconstruction" aria-labelledby="reconstruction-title">
      <header className="reconstruction__header">
        <h2 id="reconstruction-title" className="section-title">
          Reconstrução
        </h2>
        <div className="tabs" role="tablist" aria-label="Forma de ver o incidente">
          {VIEWS.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`reconstruction-tab-${option.id}`}
              aria-selected={view === option.id}
              aria-controls="reconstruction-panel"
              tabIndex={view === option.id ? 0 : -1}
              className="tabs__tab"
              onClick={() => setView(option.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>
      <div id="reconstruction-panel" role="tabpanel" aria-labelledby={`reconstruction-tab-${view}`}>
        {timeline.isError && (
          // Secondary content: a polite status, so it never competes with the alert of a failed action.
          <p className="notice notice--error" role="status">
            Não foi possível carregar a reconstrução agora. Tente novamente.
          </p>
        )}
        {!timeline.data && !timeline.isError && <p className="muted small">Montando a reconstrução…</p>}
        {timeline.data && (view === 'timeline' ? <IncidentTimeline timeline={timeline.data} /> : <IncidentGraph timeline={timeline.data} />)}
      </div>
    </section>
  );
}

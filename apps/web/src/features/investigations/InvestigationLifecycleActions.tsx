import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { InvestigationStatus } from '@aegis/contracts';
import { INVESTIGATION_LIMITS, closingConclusionProblem } from '@aegis/domain';
import { TextAreaField } from '../../components/TextAreaField';
import { transitionLabel } from './investigation-labels';

interface InvestigationLifecycleActionsProps {
  /** As reported by the API (computed by the domain lifecycle). */
  readonly available: readonly InvestigationStatus[];
  /** Stored draft, pre-filled when closing. */
  readonly conclusion: string | null;
  readonly pending: boolean;
  readonly onTransition: (status: InvestigationStatus, conclusion?: string) => void;
}

/**
 * Status buttons for the transitions the server allows. "Encerrar" opens a
 * small panel to confirm the conclusion: closing without one is blocked here
 * with the same rule the API enforces. Renders nothing once CLOSED.
 */
export function InvestigationLifecycleActions({ available, conclusion, pending, onTransition }: InvestigationLifecycleActionsProps) {
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState(conclusion ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (closing) fieldRef.current?.focus();
  }, [closing]);

  if (available.length === 0) return null;

  const close = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    const issue = closingConclusionProblem(text || null);
    setProblem(issue);
    if (!issue) onTransition('CLOSED', text);
  };

  return (
    <>
      <div className="lifecycle" role="group" aria-label="Alterar status">
        {available.map((target) => (
          <button
            key={target}
            type="button"
            className={target === 'CLOSED' ? 'button' : 'button button--primary'}
            disabled={pending || (closing && target === 'CLOSED')}
            onClick={() => (target === 'CLOSED' ? setClosing(true) : onTransition(target))}
          >
            {transitionLabel(target)}
          </button>
        ))}
      </div>
      {closing && (
        <form className="close-panel" noValidate onSubmit={close} aria-label="Encerrar investigação">
          <TextAreaField
            ref={fieldRef}
            label="Conclusão"
            rows={5}
            maxLength={INVESTIGATION_LIMITS.conclusionMax}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            hint={<small className="muted small">Registre o resultado da análise. Depois de encerrada, a investigação fica somente leitura.</small>}
            error={problem ?? undefined}
          />
          <div className="confirm__actions">
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => {
                setClosing(false);
                setProblem(null);
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="button button--primary" disabled={pending}>
              {pending ? 'Encerrando…' : 'Encerrar investigação'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

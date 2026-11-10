import { useState, type ReactNode } from 'react';

interface OneTimeSecretProps {
  readonly title: string;
  readonly value: string;
  readonly children: ReactNode;
}

/** Shows a secret that cannot be retrieved again. The value comes from the parent's state and is never stored here. */
export function OneTimeSecret({ title, value, children }: OneTimeSecretProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div className="secret-once" role="group" aria-label={title}>
      <p className="secret-once__title">{title}</p>
      <code className="secret-once__value">{value}</code>
      <div className="secret-once__actions">
        <button type="button" className="button" onClick={() => void copy()}>
          Copiar
        </button>
        <span className="muted small" role="status">
          {copyStatus === 'copied' && 'Copiado.'}
          {copyStatus === 'failed' && 'Não foi possível copiar. Selecione o texto e copie manualmente.'}
        </span>
      </div>
      {children}
    </div>
  );
}

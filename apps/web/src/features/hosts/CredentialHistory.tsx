import { MACHINE_SCOPE_LABELS, type MachineCredentialResponse } from '@aegis/contracts';
import { formatDateTime } from './host-format';

/**
 * The credentials this host had before the current one, most recent first
 * (the API keeps the 20 latest). Public metadata only: the label derived from
 * the public id, never a secret or hash. Nothing here has an action, so a
 * revoked credential can never look revocable.
 */
export function CredentialHistory({ credentials }: { readonly credentials: readonly MachineCredentialResponse[] }) {
  const previous = credentials.filter((credential) => credential.status === 'REVOKED');
  if (previous.length === 0) return null;
  const prefixOf = (id: string | null) => credentials.find((credential) => credential.id === id)?.tokenPrefix;

  return (
    <section className="credential-history" aria-labelledby="credential-history-title">
      <h3 id="credential-history-title" className="subsection-title">
        Credenciais anteriores
      </h3>
      <ul className="credential-list">
        {previous.map((credential) => {
          const successor = credentials.find((other) => other.rotatedFromCredentialId === credential.id);
          const predecessor = credential.rotatedFromCredentialId;
          return (
            <li key={credential.id} className="credential-item" aria-label={`Credencial ${credential.tokenPrefix}`}>
              <div className="credential-item__head">
                <code>{credential.tokenPrefix}</code>
                <span className={`status status--credential-${credential.status.toLowerCase()}`}>{credential.status === 'ACTIVE' ? 'Ativa' : 'Revogada'}</span>
              </div>
              <dl className="facts facts--compact">
                <div>
                  <dt>Criada em</dt>
                  <dd>{formatDateTime(credential.createdAt)}</dd>
                </div>
                <div>
                  <dt>Último uso</dt>
                  <dd>{credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : 'Nunca utilizada'}</dd>
                </div>
                <div>
                  <dt>Revogada em</dt>
                  <dd>{credential.revokedAt ? formatDateTime(credential.revokedAt) : '—'}</dd>
                </div>
                <div>
                  <dt>Escopos</dt>
                  <dd>{credential.scopes.map((scope) => MACHINE_SCOPE_LABELS[scope]).join('; ')}</dd>
                </div>
              </dl>
              {(predecessor || successor) && (
                <p className="muted small">
                  {predecessor && <>Substituiu {prefixOf(predecessor) ?? 'uma credencial anterior'} por rotação. </>}
                  {successor && <>Substituída por {successor.tokenPrefix} por rotação.</>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

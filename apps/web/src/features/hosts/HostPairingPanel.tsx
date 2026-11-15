import { useEffect, useState } from 'react';
import { MACHINE_SCOPE_LABELS, type MachineCredentialResponse } from '@aegis/contracts';
import { ConfirmAction } from '../../components/ConfirmAction';
import { ApiError } from '../../lib/api-client';
import { CredentialHistory } from './CredentialHistory';
import { formatDateTime } from './host-format';
import { useCancelPairingCode, useHostPairing, useRequestPairingCode, useRevokeCredential, useRotateCredential } from './host-pairing-api';
import { OneTimeSecret } from './OneTimeSecret';

interface HostPairingPanelProps {
  readonly workspaceId: string;
  readonly hostId: string;
  /** Display only: the API decides, and a refused action shows its message. */
  readonly canManage: boolean;
}

type Issued = { readonly kind: 'code'; readonly value: string; readonly expiresAt: string } | { readonly kind: 'token'; readonly value: string };

const errorMessageOf = (error: unknown) =>
  error instanceof ApiError && [403, 409, 429].includes(error.status) ? error.message : 'Não foi possível concluir a ação agora. Tente novamente.';

/** The address the Collector must use: this panel's own origin (Nginx serves the API under /api). */
const serverAddress = () => window.location.origin;

/**
 * Authorizes a Collector for this host and manages its credential. Pairing,
 * connectivity and telemetry are different things and are worded apart: an
 * active credential is "paired", never "online" by itself.
 *
 * Secrets stay in this component's state: leaving the screen unmounts it and
 * they are gone. They are never written to browser storage or to a query cache.
 */
export function HostPairingPanel({ workspaceId, hostId, canManage }: HostPairingPanelProps) {
  const pairing = useHostPairing(workspaceId, hostId);
  const requestCode = useRequestPairingCode(workspaceId, hostId);
  const cancelCode = useCancelPairingCode(workspaceId, hostId);
  const rotate = useRotateCredential(workspaceId, hostId);
  const revoke = useRevokeCredential(workspaceId, hostId);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const expiresAt = issued?.kind === 'code' ? issued.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = setTimeout(() => {
      setIssued(null);
      setResult('O código expirou e foi removido da tela. Gere um novo para parear este host.');
    }, new Date(expiresAt).getTime() - Date.now());
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (pairing.isError) {
    return (
      <section className="surface" aria-labelledby="pairing-title">
        <h2 id="pairing-title" className="section-title">
          Pareamento do Collector
        </h2>
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o pareamento deste host agora. Tente novamente.
        </p>
      </section>
    );
  }

  const data = pairing.data;
  const active = data?.activeCredential ?? null;
  const latest = data?.credentials[0] ?? null;
  // Once a machine used the code, the code has no further purpose on screen.
  const visible = issued?.kind === 'code' && active ? null : issued;
  const actionError = requestCode.error ?? cancelCode.error ?? rotate.error ?? revoke.error;

  const resetAll = () => {
    requestCode.reset();
    cancelCode.reset();
    rotate.reset();
    revoke.reset();
    setResult(null);
  };

  const generate = () => {
    resetAll();
    requestCode.mutate(undefined, { onSuccess: ({ code, expiresAt: expiry }) => setIssued({ kind: 'code', value: code, expiresAt: expiry }) });
  };

  const cancelPending = async (challengeId: string) => {
    resetAll();
    await cancelCode.mutateAsync(challengeId);
    setIssued(null);
    setResult('Código cancelado. Ele não pode mais ser usado para parear este host.');
  };

  const rotateActive = async (credential: MachineCredentialResponse) => {
    resetAll();
    const { token } = await rotate.mutateAsync(credential.id);
    setIssued({ kind: 'token', value: token });
    setResult('Credencial rotacionada. A credencial anterior deixou de funcionar.');
  };

  const revokeActive = async (credential: MachineCredentialResponse) => {
    resetAll();
    await revoke.mutateAsync(credential.id);
    setIssued(null);
    setResult('Credencial revogada. Este Collector não consegue mais enviar eventos nem heartbeat.');
  };

  return (
    <section className="surface pairing-panel" aria-labelledby="pairing-title">
      <h2 id="pairing-title" className="section-title">
        Pareamento do Collector
      </h2>

      {result && (
        <p className="notice notice--success" role="status">
          {result}
        </p>
      )}
      {actionError && (
        <p className="notice notice--error" role="alert">
          {errorMessageOf(actionError)}
        </p>
      )}

      {visible?.kind === 'code' && (
        <OneTimeSecret title="Código de pareamento" value={visible.value}>
          <p className="muted small">Válido até {formatDateTime(visible.expiresAt)}. Este código é exibido uma única vez e não poderá ser recuperado depois.</p>
          <p className="muted small">Não compartilhe este código: quem o tiver pode conectar uma máquina a este host. Ele será usado uma única vez pelo Aegis Collector.</p>
          <p className="muted small">
            No host, execute <code className="command">aegis-collector pair --server {serverAddress()}</code> e cole o código quando ele for pedido (não aparece na tela).
          </p>
        </OneTimeSecret>
      )}
      {visible?.kind === 'token' && (
        <OneTimeSecret title="Nova credencial de máquina" value={visible.value}>
          <p className="muted small">Esta credencial é exibida uma única vez e não poderá ser recuperada depois.</p>
          <p className="muted small">
            No host, execute <code className="command">aegis-collector replace-credential</code> e cole a credencial quando ela for pedida; até lá o Collector
            não consegue enviar eventos.
          </p>
        </OneTimeSecret>
      )}

      {!data && <p className="muted">Carregando pareamento…</p>}

      {data && !active && (
        <>
          {latest?.status === 'REVOKED' && latest.revokedAt && (
            <p className="notice notice--warn">
              Credencial {latest.tokenPrefix} revogada em {formatDateTime(latest.revokedAt)}. O Collector deste host não consegue mais enviar heartbeat nem eventos.
            </p>
          )}
          <p>Host ainda não pareado.</p>
          <p className="muted small">O Aegis Collector ainda precisa ser conectado a este host. Gerar um código autoriza a conexão, mas não instala nem conecta nada.</p>
          {data.pendingCode && !visible && (
            <p className="muted small">Há um código pendente, válido até {formatDateTime(data.pendingCode.expiresAt)}. Ele não pode ser exibido novamente; gerar outro invalida o anterior.</p>
          )}
          {canManage ? (
            <div className="detail-actions">
              <button type="button" className="button button--primary" disabled={requestCode.isPending} onClick={generate}>
                {requestCode.isPending ? 'Gerando…' : visible?.kind === 'code' || data.pendingCode ? 'Gerar novo código' : 'Parear Collector'}
              </button>
              {data.pendingCode && (
                <ConfirmAction
                  key={`cancel-${data.pendingCode.id}`}
                  triggerLabel="Cancelar código"
                  title="Cancelar o código de pareamento pendente?"
                  description="O código deixa de funcionar imediatamente. Se uma máquina já o usou, a credencial criada não é afetada."
                  confirmLabel="Cancelar código"
                  pendingLabel="Cancelando…"
                  dismissLabel="Manter código"
                  onConfirm={() => cancelPending(data.pendingCode?.id ?? '')}
                />
              )}
            </div>
          ) : (
            <p className="muted small">Somente o proprietário do workspace pode parear este host.</p>
          )}
        </>
      )}

      {data && active && (
        <>
          <dl className="facts">
            <div>
              <dt>Pareamento</dt>
              <dd>Pareado</dd>
            </div>
            <div>
              <dt>Credencial</dt>
              <dd>Ativa</dd>
            </div>
            <div>
              <dt>Identificador público</dt>
              <dd>
                <code>{active.tokenPrefix}</code>
              </dd>
            </div>
            <div>
              <dt>Criada em</dt>
              <dd>{formatDateTime(active.createdAt)}</dd>
            </div>
            <div>
              <dt>Última utilização da credencial</dt>
              <dd>{active.lastUsedAt ? formatDateTime(active.lastUsedAt) : 'Nunca utilizada'}</dd>
            </div>
            <div>
              <dt>Escopos</dt>
              <dd>{active.scopes.map((scope) => MACHINE_SCOPE_LABELS[scope]).join('; ')}</dd>
            </div>
            {active.rotatedFromCredentialId && (
              <div>
                <dt>Origem</dt>
                <dd>Rotação de {data.credentials.find((credential) => credential.id === active.rotatedFromCredentialId)?.tokenPrefix ?? 'uma credencial anterior'}</dd>
              </div>
            )}
          </dl>
          {!active.scopes.includes('host:heartbeat') && (
            <p className="notice notice--warn">
              Esta credencial foi emitida antes do heartbeat existir: ela envia eventos, mas não informa atividade, então o host não aparece como online. Rotacione-a e
              instale a nova no host com <code className="command">aegis-collector replace-credential</code>.
            </p>
          )}
          <p className="muted small">“Pareado” significa que existe uma credencial ativa, não que o Collector esteja online. A última utilização da credencial também não é o último evento recebido.</p>
          {canManage ? (
            <div className="detail-actions">
              {/* Keyed by credential: after a rotation or revocation the confirmation closes. */}
              <ConfirmAction
                key={`rotate-${active.id}`}
                triggerLabel="Rotacionar credencial"
                title="Rotacionar esta credencial?"
                description="Uma nova credencial será criada e a atual deixará de funcionar imediatamente. O Collector só voltará a enviar eventos depois de receber a nova credencial."
                confirmLabel="Rotacionar"
                pendingLabel="Rotacionando…"
                onConfirm={() => rotateActive(active)}
              />
              <ConfirmAction
                key={`revoke-${active.id}`}
                triggerLabel="Revogar credencial"
                title="Revogar esta credencial?"
                description="Este Collector deixará de conseguir enviar eventos imediatamente. A revogação não pode ser desfeita: será preciso parear o host novamente."
                confirmLabel="Revogar"
                pendingLabel="Revogando…"
                onConfirm={() => revokeActive(active)}
              />
            </div>
          ) : (
            <p className="muted small">Somente o proprietário do workspace pode rotacionar ou revogar esta credencial.</p>
          )}
        </>
      )}

      {data && <CredentialHistory credentials={data.credentials} />}
    </section>
  );
}

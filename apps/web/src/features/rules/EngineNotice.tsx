/** Honest, low-key statement that rules are configuration only for now. */
export function EngineNotice() {
  return (
    <p className="engine-notice" role="note">
      <span className="engine-notice__dot" aria-hidden="true" />
      Motor de detecção ainda não conectado. As regras ficam configuradas e serão usadas quando a ingestão de eventos estiver ativa.
    </p>
  );
}

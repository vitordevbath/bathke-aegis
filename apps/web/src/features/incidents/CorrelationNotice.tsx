/** Honest statement that incidents are registered by hand for now. */
export function CorrelationNotice() {
  return (
    <p className="engine-notice" role="note">
      <span className="engine-notice__dot" aria-hidden="true" />
      Incidentes são registrados manualmente. A correlação automática de eventos ainda não está ativa.
    </p>
  );
}

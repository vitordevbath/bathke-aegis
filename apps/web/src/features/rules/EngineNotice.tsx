/** Honest, low-key statement that rules are configuration only for now. */
export function EngineNotice() {
  return (
    <p className="engine-notice" role="note">
      <span className="engine-notice__dot" aria-hidden="true" />
      Motor de detecção ainda não conectado. Os eventos já chegam pelo Collector, mas as regras ficam apenas configuradas: nenhuma é avaliada sobre
      eles ainda.
    </p>
  );
}

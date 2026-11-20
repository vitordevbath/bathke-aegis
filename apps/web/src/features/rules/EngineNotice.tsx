/** Low-key statement of what the engine does with rules (ADR-053). */
export function EngineNotice() {
  return (
    <p className="engine-notice" role="note">
      <span className="engine-notice__dot engine-notice__dot--on" aria-hidden="true" />
      Motor de detecção ativo: cada evento recebido é avaliado pelas regras habilitadas da sua categoria. Um evento que casa gera um alerta, e alertas da
      mesma regra no mesmo host entram no mesmo incidente.
    </p>
  );
}

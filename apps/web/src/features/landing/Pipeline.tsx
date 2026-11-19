import { useRef } from 'react';
import { useActiveIndex } from './motion';

const NODES = ['Host Linux', 'Aegis Collector', 'Fila local', 'API e Event Store', 'Painel'] as const;

/** Real sequence: the order a machine goes through, from pairing to investigation. Each step lights the parts it involves. */
const STEPS = [
  {
    title: 'Parear',
    lit: [1, 3, 4],
    body: 'No painel, você gera um código de uso único que vale por 10 minutos. O Collector troca esse código por uma credencial de máquina, mostrada uma única vez e guardada só como hash no servidor.',
  },
  {
    title: 'Observar',
    lit: [0, 1],
    body: 'O Collector, escrito em Rust, roda em primeiro plano e com o seu usuário. Ele registra o boot e as mudanças de estado dos serviços do systemd e envia um heartbeat a cada 30 segundos.',
  },
  {
    title: 'Entregar',
    lit: [1, 2, 3],
    body: 'Os eventos esperam numa fila SQLite até a API confirmar o recebimento, em lotes de até 100. Se a rede cair, nada se perde; se um lote for reenviado, nada se duplica.',
  },
  {
    title: 'Investigar',
    lit: [3, 4],
    body: 'As regras habilitadas avaliam cada evento na hora em que ele chega. Um evento que casa vira um alerta, e alertas da mesma regra no mesmo host se juntam num incidente, que uma pessoa investiga e encerra com uma conclusão escrita.',
  },
] as const;

/** Sticky diagram on wide screens; the step crossing the middle of the viewport decides what is lit. */
export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useActiveIndex('.lp-step', ref);
  const lit = new Set<number>(STEPS[active]?.lit ?? []);

  return (
    <div ref={ref} className="lp-pipeline" data-step={active}>
      <div className="lp-pipeline__stage" aria-hidden="true">
        <ol className="lp-chain">
          {NODES.map((node, index) => (
            <li key={node} className={`lp-chain__node${lit.has(index) ? ' lp-chain__node--lit' : ''}`}>
              <span className="lp-chain__dot" />
              <span className="lp-chain__label">{node}</span>
            </li>
          ))}
        </ol>
      </div>
      <ol className="lp-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className={`lp-step${index === active ? ' lp-step--active' : ''}`}>
            <span className="lp-step__index">{index + 1}</span>
            <h3 className="lp-step__title">{step.title}</h3>
            <p className="lp-step__body">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

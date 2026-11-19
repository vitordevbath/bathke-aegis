import { useSeen } from './motion';

/** Fields the Event Contract v1 rejects at the API (docs/EVENTOS.md). */
const NEVER = ['Linhas de comando', 'Variáveis de ambiente', 'Conteúdo de arquivos', 'Mensagens', 'Conteúdo de pacotes de rede', 'Senhas e tokens'] as const;

/** The struck-through list draws its strike once, when it first comes into view. */
export function NotCollected() {
  const [ref, seen] = useSeen<HTMLUListElement>(0.4);
  return (
    <ul ref={ref} className={`lp-never${seen ? ' lp-never--struck' : ''}`}>
      {NEVER.map((item) => (
        <li key={item} className="lp-never__item">
          <span className="visually-hidden">Não coleta: </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

import { PasswordPolicy } from '@aegis/domain';

/** Live view of the password policy — the same rules the API enforces. */
export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="checklist" aria-label="Requisitos da senha">
      {PasswordPolicy.RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className={met ? 'checklist__item checklist__item--met' : 'checklist__item'}>
            <span className="visually-hidden">{met ? 'Atendido: ' : 'Pendente: '}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

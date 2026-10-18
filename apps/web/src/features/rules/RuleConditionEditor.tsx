import { useFieldArray, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue, type UseFormWatch } from 'react-hook-form';
import { DETECTION_FIELDS, DETECTION_LIMITS, detectionFieldSpec } from '@aegis/domain';
import { MATCH_CONNECTOR, OPERATOR_LABELS, fieldLabel } from './rule-labels';
import { defaultCondition, operatorsFor, type RuleFormValues } from './rule-form-model';

interface RuleConditionEditorProps {
  readonly control: Control<RuleFormValues>;
  readonly register: UseFormRegister<RuleFormValues>;
  readonly watch: UseFormWatch<RuleFormValues>;
  readonly setValue: UseFormSetValue<RuleFormValues>;
  readonly errors: FieldErrors<RuleFormValues>;
}

/**
 * Structured condition builder: field (allowlisted for the category),
 * operator (allowed for the field type) and value. No free-form expressions.
 */
export function RuleConditionEditor({ control, register, watch, setValue, errors }: RuleConditionEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'conditions' });
  const category = watch('eventCategory');
  const match = watch('match');

  return (
    <div className="conditions">
      <ol className="conditions__list">
        {fields.map((item, index) => {
          const fieldId = watch(`conditions.${index}.field`);
          const operator = watch(`conditions.${index}.operator`);
          const spec = detectionFieldSpec(category, fieldId);
          const rowErrors = errors.conditions?.[index];
          const fieldRegistration = register(`conditions.${index}.field`);
          return (
            <li key={item.id} className="condition">
              <span className="condition__connector" aria-hidden="true">
                {index === 0 ? 'SE' : MATCH_CONNECTOR[match]}
              </span>
              <div className="condition__inputs">
                <label className="visually-hidden" htmlFor={`condition-${index}-field`}>{`Campo da condição ${index + 1}`}</label>
                <select
                  id={`condition-${index}-field`}
                  aria-invalid={rowErrors?.field ? true : undefined}
                  {...fieldRegistration}
                  onChange={(event) => {
                    void fieldRegistration.onChange(event);
                    // Keep the operator valid for the new field type.
                    if (!operatorsFor(category, event.target.value).includes(operator)) setValue(`conditions.${index}.operator`, 'EQUALS');
                  }}
                >
                  {DETECTION_FIELDS[category].map((field) => (
                    <option key={field.id} value={field.id}>
                      {fieldLabel(field.id)}
                    </option>
                  ))}
                </select>
                <label className="visually-hidden" htmlFor={`condition-${index}-operator`}>{`Operador da condição ${index + 1}`}</label>
                <select id={`condition-${index}-operator`} aria-invalid={rowErrors?.operator ? true : undefined} {...register(`conditions.${index}.operator`)}>
                  {operatorsFor(category, fieldId).map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </select>
                <label className="visually-hidden" htmlFor={`condition-${index}-value`}>{`Valor da condição ${index + 1}`}</label>
                <input
                  id={`condition-${index}-value`}
                  inputMode={spec?.type === 'integer' ? 'numeric' : undefined}
                  placeholder={operator === 'IN' ? 'valores separados por vírgula' : spec?.type === 'integer' ? 'número' : 'valor'}
                  maxLength={DETECTION_LIMITS.maxStringValue * 4}
                  aria-invalid={rowErrors?.value ? true : undefined}
                  {...register(`conditions.${index}.value`)}
                />
                <button
                  type="button"
                  className="button button--ghost condition__remove"
                  aria-label={`Remover condição ${index + 1}`}
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                >
                  Remover
                </button>
              </div>
              {(rowErrors?.field || rowErrors?.operator || rowErrors?.value) && (
                <small className="field__error" role="alert">
                  {rowErrors.field?.message ?? rowErrors.operator?.message ?? rowErrors.value?.message}
                </small>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="button"
        disabled={fields.length >= DETECTION_LIMITS.maxConditions}
        onClick={() => append(defaultCondition(category))}
      >
        Adicionar condição
      </button>
    </div>
  );
}

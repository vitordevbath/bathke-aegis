import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import type { CreateDetectionRuleRequest, DetectionEventCategory } from '@aegis/contracts';
import {
  DETECTION_EVENT_CATEGORIES,
  DETECTION_MATCH_MODES,
  DETECTION_RULE_LIMITS,
  DETECTION_SCOPES,
  DETECTION_SEVERITIES,
} from '@aegis/domain';
import { TextField } from '../../components/TextField';
import { TextAreaField } from '../../components/TextAreaField';
import { SelectField } from '../../components/SelectField';
import { ApiError } from '../../lib/api-client';
import { CATEGORY_LABELS, MATCH_LABELS, SCOPE_LABELS, SEVERITY_LABELS } from './rule-labels';
import { RuleConditionEditor } from './RuleConditionEditor';
import { RuleTargetSelector } from './RuleTargetSelector';
import { EngineNotice } from './EngineNotice';
import { applyRuleIssues, defaultCondition, emptyRuleForm, formToRequest, validateRuleForm, type RuleFormValues } from './rule-form-model';

interface DetectionRuleFormProps {
  readonly workspaceId: string | undefined;
  readonly defaultValues?: RuleFormValues;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly cancelTo: string;
  readonly onSubmit: (body: CreateDetectionRuleRequest) => Promise<void>;
}

/**
 * Shared by the create and edit pages (separate screens). Validates with the
 * same schema as the API before submitting; the API remains the authority.
 */
export function DetectionRuleForm({ workspaceId, defaultValues, submitLabel, pendingLabel, cancelTo, onSubmit }: DetectionRuleFormProps) {
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({ defaultValues: defaultValues ?? emptyRuleForm() });

  const scope = watch('scope');
  const categoryField = register('eventCategory');

  const submit = handleSubmit(async (values) => {
    clearErrors();
    setFormErrors([]);
    const issues = validateRuleForm(values);
    if (issues.length > 0) {
      setFormErrors(applyRuleIssues(issues, setError));
      return;
    }
    try {
      await onSubmit(formToRequest(values));
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) setFormErrors(applyRuleIssues(error.issues, setError));
      else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN') setFormErrors([error.message]);
      else setFormErrors(['Não foi possível salvar a regra agora. Tente novamente.']);
    }
  });

  return (
    <form className="form form--wide rule-form" noValidate onSubmit={submit}>
      <EngineNotice />

      <section className="surface rule-section" aria-labelledby="rule-identity">
        <h2 id="rule-identity" className="section-title">
          Identificação
        </h2>
        <TextField label="Nome" maxLength={DETECTION_RULE_LIMITS.nameMax} error={errors.name?.message} {...register('name')} />
        <TextAreaField
          label="Descrição"
          rows={2}
          maxLength={DETECTION_RULE_LIMITS.descriptionMax}
          placeholder="Opcional — o que esta regra procura e por quê."
          error={errors.description?.message}
          {...register('description')}
        />
        <div className="form__row">
          <SelectField label="Severidade" error={errors.severity?.message} {...register('severity')}>
            {DETECTION_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_LABELS[severity]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Categoria de evento"
            error={errors.eventCategory?.message}
            {...categoryField}
            onChange={(event) => {
              void categoryField.onChange(event);
              // Fields are category-specific: start the conditions over with a valid field.
              const category = event.target.value as DetectionEventCategory;
              setValue('conditions', getValues('conditions').map(() => defaultCondition(category)));
            }}
          >
            {DETECTION_EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="switch">
          <input type="checkbox" {...register('enabled')} />
          <span>Habilitada</span>
          <small className="field__hint">Pronta para uso quando o motor de detecção estiver ativo.</small>
        </label>
      </section>

      <section className="surface rule-section" aria-labelledby="rule-conditions">
        <h2 id="rule-conditions" className="section-title">
          Condições
        </h2>
        <SelectField label="Combinar" {...register('match')}>
          {DETECTION_MATCH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MATCH_LABELS[mode]}
            </option>
          ))}
        </SelectField>
        <RuleConditionEditor control={control} register={register} watch={watch} setValue={setValue} errors={errors} />
        <details className="definition-preview">
          <summary>Visualizar definição</summary>
          <pre>{JSON.stringify(formToRequest(watch()).definition, null, 2)}</pre>
        </details>
      </section>

      <section className="surface rule-section" aria-labelledby="rule-scope">
        <h2 id="rule-scope" className="section-title">
          Escopo
        </h2>
        <div className="radio-group" role="radiogroup" aria-label="Escopo">
          {DETECTION_SCOPES.map((option) => (
            <label key={option} className="radio">
              <input type="radio" value={option} {...register('scope')} />
              <span>{SCOPE_LABELS[option]}</span>
            </label>
          ))}
        </div>
        {scope === 'SELECTED_HOSTS' ? (
          <Controller
            control={control}
            name="hostIds"
            render={({ field }) => (
              <RuleTargetSelector workspaceId={workspaceId} value={field.value} onChange={field.onChange} error={errors.hostIds?.message} />
            )}
          />
        ) : (
          <p className="muted small">A regra vale para todos os hosts deste workspace, inclusive os cadastrados depois.</p>
        )}
      </section>

      {formErrors.length > 0 && (
        <div className="notice notice--error" role="alert">
          {formErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <div className="form__actions">
        <Link to={cancelTo} className="button button--ghost">
          Cancelar
        </Link>
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

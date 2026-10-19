import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import type { CreateIncidentRequest } from '@aegis/contracts';
import { INCIDENT_LIMITS, SEVERITIES } from '@aegis/domain';
import { TextField } from '../../components/TextField';
import { TextAreaField } from '../../components/TextAreaField';
import { SelectField } from '../../components/SelectField';
import { ApiError } from '../../lib/api-client';
import { SEVERITY_LABELS } from '../../lib/severity';
import { HostPicker } from '../hosts/HostPicker';
import { IncidentRuleSelector } from './IncidentRuleSelector';
import { applyIncidentIssues, emptyIncidentForm, formToRequest, validateIncidentForm, type IncidentFormValues } from './incident-form-model';

interface IncidentFormProps {
  readonly workspaceId: string | undefined;
  readonly defaultValues?: IncidentFormValues;
  /** Context shown above the actions (e.g. initial status on create). */
  readonly footnote?: ReactNode;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly cancelTo: string;
  readonly onSubmit: (body: CreateIncidentRequest) => Promise<void>;
}

/**
 * Shared by the create and edit pages (separate screens). Validates with the
 * same schema as the API before submitting; the API remains the authority.
 */
export function IncidentForm({ workspaceId, defaultValues, footnote, submitLabel, pendingLabel, cancelTo, onSubmit }: IncidentFormProps) {
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<IncidentFormValues>({ defaultValues: defaultValues ?? emptyIncidentForm() });

  const submit = handleSubmit(async (values) => {
    clearErrors();
    setFormErrors([]);
    const issues = validateIncidentForm(values);
    if (issues.length > 0) {
      setFormErrors(applyIncidentIssues(issues, setError));
      return;
    }
    try {
      await onSubmit(formToRequest(values));
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) setFormErrors(applyIncidentIssues(error.issues, setError));
      else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN') setFormErrors([error.message]);
      else setFormErrors(['Não foi possível salvar o incidente agora. Tente novamente.']);
    }
  });

  return (
    <form className="form form--wide rule-form" noValidate onSubmit={submit}>
      <section className="surface rule-section" aria-labelledby="incident-identity">
        <h2 id="incident-identity" className="section-title">
          Identificação
        </h2>
        <TextField label="Título" maxLength={INCIDENT_LIMITS.titleMax} error={errors.title?.message} {...register('title')} />
        <TextAreaField
          label="Descrição"
          rows={4}
          maxLength={INCIDENT_LIMITS.descriptionMax}
          placeholder="Opcional — o que foi observado, por quem e quando. Texto simples."
          error={errors.description?.message}
          {...register('description')}
        />
        <SelectField label="Severidade" error={errors.severity?.message} {...register('severity')}>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABELS[severity]}
            </option>
          ))}
        </SelectField>
      </section>

      <section className="surface rule-section" aria-labelledby="incident-hosts">
        <h2 id="incident-hosts" className="section-title">
          Hosts envolvidos
        </h2>
        <Controller
          control={control}
          name="hostIds"
          render={({ field }) => (
            <HostPicker
              workspaceId={workspaceId}
              legend="Selecione pelo menos um host"
              value={field.value}
              onChange={field.onChange}
              error={errors.hostIds?.message}
              emptyMessage={
                <>
                  Nenhum host neste workspace. <Link to="/hosts/novo">Cadastre um host</Link> para registrar um incidente.
                </>
              }
            />
          )}
        />
      </section>

      <section className="surface rule-section" aria-labelledby="incident-rules">
        <h2 id="incident-rules" className="section-title">
          Regras relacionadas
        </h2>
        <Controller
          control={control}
          name="detectionRuleIds"
          render={({ field }) => (
            <IncidentRuleSelector workspaceId={workspaceId} value={field.value} onChange={field.onChange} error={errors.detectionRuleIds?.message} />
          )}
        />
      </section>

      {footnote}
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

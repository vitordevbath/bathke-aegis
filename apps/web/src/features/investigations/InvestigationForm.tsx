import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import type { UpdateInvestigationRequest } from '@aegis/contracts';
import { INVESTIGATION_LIMITS } from '@aegis/domain';
import { TextField } from '../../components/TextField';
import { TextAreaField } from '../../components/TextAreaField';
import { ApiError } from '../../lib/api-client';
import { InvestigationIncidentSelector } from './InvestigationIncidentSelector';
import {
  applyInvestigationIssues,
  emptyInvestigationForm,
  formToRequest,
  validateInvestigationForm,
  type InvestigationFormValues,
} from './investigation-form-model';

interface InvestigationFormProps {
  readonly workspaceId: string | undefined;
  readonly defaultValues?: InvestigationFormValues;
  /** Edit screen only: shows the draft conclusion field. */
  readonly withConclusion?: boolean;
  /** Context shown above the actions (e.g. initial status on create). */
  readonly footnote?: ReactNode;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly cancelTo: string;
  readonly onSubmit: (body: Omit<UpdateInvestigationRequest, 'status'>) => Promise<void>;
}

/**
 * Shared by the create and edit pages (separate screens). Validates with the
 * same schema as the API before submitting; the API remains the authority.
 */
export function InvestigationForm({
  workspaceId,
  defaultValues,
  withConclusion = false,
  footnote,
  submitLabel,
  pendingLabel,
  cancelTo,
  onSubmit,
}: InvestigationFormProps) {
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<InvestigationFormValues>({ defaultValues: defaultValues ?? emptyInvestigationForm() });

  const submit = handleSubmit(async (values) => {
    clearErrors();
    setFormErrors([]);
    const issues = validateInvestigationForm(values, withConclusion);
    if (issues.length > 0) {
      setFormErrors(applyInvestigationIssues(issues, setError));
      return;
    }
    try {
      await onSubmit(formToRequest(values, withConclusion));
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) setFormErrors(applyInvestigationIssues(error.issues, setError));
      else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN') setFormErrors([error.message]);
      else setFormErrors(['Não foi possível salvar a investigação agora. Tente novamente.']);
    }
  });

  return (
    <form className="form form--wide rule-form" noValidate onSubmit={submit}>
      <section className="surface rule-section" aria-labelledby="investigation-identity">
        <h2 id="investigation-identity" className="section-title">
          Identificação
        </h2>
        <TextField label="Título" maxLength={INVESTIGATION_LIMITS.titleMax} error={errors.title?.message} {...register('title')} />
        <TextAreaField
          label="Descrição"
          rows={4}
          maxLength={INVESTIGATION_LIMITS.descriptionMax}
          placeholder="Opcional — o objetivo da análise e o que liga os incidentes. Texto simples."
          error={errors.description?.message}
          {...register('description')}
        />
      </section>

      <section className="surface rule-section" aria-labelledby="investigation-incidents">
        <h2 id="investigation-incidents" className="section-title">
          Incidentes relacionados
        </h2>
        <Controller
          control={control}
          name="incidentIds"
          render={({ field }) => (
            <InvestigationIncidentSelector workspaceId={workspaceId} value={field.value} onChange={field.onChange} error={errors.incidentIds?.message} />
          )}
        />
      </section>

      {withConclusion && (
        <section className="surface rule-section" aria-labelledby="investigation-conclusion">
          <h2 id="investigation-conclusion" className="section-title">
            Conclusão
          </h2>
          <TextAreaField
            label="Conclusão preliminar"
            rows={5}
            maxLength={INVESTIGATION_LIMITS.conclusionMax}
            placeholder="Opcional enquanto a investigação estiver aberta. Texto simples."
            hint={<small className="muted small">Obrigatória para encerrar a investigação.</small>}
            error={errors.conclusion?.message}
            {...register('conclusion')}
          />
        </section>
      )}

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

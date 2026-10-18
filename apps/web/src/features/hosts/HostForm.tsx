import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateHostRequestSchema, type CreateHostRequest, type HostDetailsCommand } from '@aegis/contracts';
import { HOST_LIMITS } from '@aegis/domain';
import { TextField } from '../../components/TextField';
import { TextAreaField } from '../../components/TextAreaField';
import { applyApiError } from '../../lib/form-errors';

interface HostFormProps {
  readonly defaultValues?: CreateHostRequest;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly cancelTo: string;
  readonly onSubmit: (details: HostDetailsCommand) => Promise<void>;
}

/**
 * Administrative fields of a host, shared by the create and edit pages.
 * Collector-controlled fields are not part of this form.
 */
export function HostForm({ defaultValues, submitLabel, pendingLabel, cancelTo, onSubmit }: HostFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateHostRequest, unknown, HostDetailsCommand>({
    resolver: zodResolver(CreateHostRequestSchema),
    defaultValues: defaultValues ?? { displayName: '', description: '' },
  });

  const submit = handleSubmit(async (details) => {
    setFormError(null);
    try {
      await onSubmit(details);
    } catch (error) {
      setFormError(applyApiError(error, setError, ['displayName', 'description'], 'Não foi possível salvar o host agora. Tente novamente.'));
    }
  });

  const descriptionLength = (watch('description') ?? '').length;

  return (
    <form className="surface form form--wide" noValidate onSubmit={submit}>
      <TextField
        label="Nome do host"
        placeholder="Servidor principal"
        maxLength={HOST_LIMITS.displayNameMax}
        error={errors.displayName?.message}
        {...register('displayName')}
      />
      <TextAreaField
        label="Descrição"
        rows={3}
        maxLength={HOST_LIMITS.descriptionMax}
        placeholder="Opcional — finalidade ou ambiente da máquina."
        error={errors.description?.message}
        hint={
          <small className="field__hint">
            {descriptionLength}/{HOST_LIMITS.descriptionMax}
          </small>
        }
        {...register('description')}
      />
      {formError && (
        <p className="notice notice--error" role="alert">
          {formError}
        </p>
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

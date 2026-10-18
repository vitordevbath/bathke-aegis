import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly ref?: Ref<HTMLSelectElement>;
  readonly children: ReactNode;
}

/** Labelled select with the same accessibility wiring as `TextField`. */
export function SelectField({ label, error, hint, id, ref, children, ...select }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <select id={fieldId} ref={ref} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...select}>
        {children}
      </select>
      {hint}
      {error && (
        <small id={errorId} className="field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

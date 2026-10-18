import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line counterpart of `TextField`, same accessibility wiring. */
export function TextAreaField({ label, error, hint, id, ref, ...textarea }: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;

  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...textarea}
      />
      {hint}
      {error && (
        <small id={errorId} className="field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

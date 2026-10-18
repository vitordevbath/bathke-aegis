import { useEffect, useId, useRef, useState } from 'react';

interface ConfirmActionProps {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly onConfirm: () => Promise<void>;
}

/**
 * Two-step destructive action rendered inline: the trigger reveals a small
 * confirmation panel. Focus moves to "Cancelar" (the safe choice); Escape
 * cancels and focus returns to the trigger.
 */
export function ConfirmAction({ triggerLabel, title, description, confirmLabel, pendingLabel, onConfirm }: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  if (!open) {
    return (
      <button ref={triggerRef} type="button" className="button button--danger-ghost" onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
    );
  }

  return (
    <div
      className="confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => event.key === 'Escape' && !pending && close()}
    >
      <p id={titleId} className="confirm__title">
        {title}
      </p>
      <p id={descriptionId} className="muted small">
        {description}
      </p>
      <div className="confirm__actions">
        <button ref={cancelRef} type="button" className="button" disabled={pending} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
            } catch {
              // The caller renders its own error message; keep the panel open for a retry.
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <section className="empty-state" aria-label={title}>
      <span className="empty-state__mark" aria-hidden="true" />
      <h2 className="empty-state__title">{title}</h2>
      <p className="muted">{description}</p>
      {action}
    </section>
  );
}

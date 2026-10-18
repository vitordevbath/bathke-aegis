import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';

/** Decorates a unit of work so that one repository insert fails mid-transaction. */
export function failingOn(unitOfWork: UnitOfWork, table: 'workspaces' | 'memberships'): UnitOfWork {
  return {
    run: (work) =>
      unitOfWork.run((repositories) => {
        const boom = async () => {
          throw new Error(`simulated ${table} failure`);
        };
        const sabotaged: Repositories =
          table === 'workspaces'
            ? { ...repositories, workspaces: { insert: boom } }
            : { ...repositories, memberships: { insert: boom, listForUser: (id) => repositories.memberships.listForUser(id) } };
        return work(sabotaged);
      }),
  };
}

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
            ? { ...repositories, workspaces: { insert: boom, findFirstOfKind: (kind) => repositories.workspaces.findFirstOfKind(kind) } }
            : {
                ...repositories,
                memberships: {
                  insert: boom,
                  find: (userId, workspaceId) => repositories.memberships.find(userId, workspaceId),
                  listForUser: (id) => repositories.memberships.listForUser(id),
                  grantToUsersWithout: (workspaceId, role, now) => repositories.memberships.grantToUsersWithout(workspaceId, role, now),
                },
              };
        return work(sabotaged);
      }),
  };
}

import type { MembershipRole, WorkspaceKind } from '@aegis/contracts';

export const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  ANALYST: 'Analista',
  VIEWER: 'Leitor',
};

export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  personal: 'Pessoal',
  demo: 'Demonstração',
  organization: 'Organização',
  lab: 'Laboratório',
};

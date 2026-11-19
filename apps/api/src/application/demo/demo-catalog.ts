import type { DetectionRuleDetails } from '../../domain/detection-rule.js';

/**
 * Content of the AEGIS DEMO workspace (ADR-052). Everything here is sample data created through the
 * regular use cases; hosts say in their own description whether they are simulated or real.
 */

/** The system account that owns the demo. Its password is random and discarded: nobody can sign in as it. */
export const DEMO_OPERATOR = {
  name: 'Operador do AEGIS DEMO',
  // RFC 2606 reserves `.invalid`: this address can never belong to anyone.
  email: 'operador@aegis-demo.invalid',
} as const;

export type DemoHostKey = 'web' | 'db' | 'lab' | 'server';

export interface DemoHostSpec {
  readonly key: DemoHostKey;
  readonly displayName: string;
  readonly description: string;
  /** Simulated hosts are paired and driven by the simulator; the real one waits for the operator's Collector. */
  readonly simulated: boolean;
  /** Services whose state changes the simulator reports for this host. */
  readonly services: readonly string[];
}

const SIMULATED = 'Host simulado do AEGIS DEMO: o heartbeat e os eventos de sistema são sintéticos, gerados pelo próprio servidor.';

export const DEMO_HOSTS: readonly DemoHostSpec[] = [
  { key: 'web', displayName: 'srv-web-01', description: `${SIMULATED} Papel fictício: servidor web.`, simulated: true, services: ['nginx', 'sshd', 'cron'] },
  { key: 'db', displayName: 'srv-db-01', description: `${SIMULATED} Papel fictício: banco de dados.`, simulated: true, services: ['mysqld', 'sshd', 'chronyd'] },
  {
    key: 'lab',
    displayName: 'lab-vm-ubuntu',
    description: `${SIMULATED} Papel fictício: VM de laboratório que liga e desliga, por isso alterna entre Online e Offline.`,
    simulated: true,
    services: ['docker', 'sshd', 'snapd'],
  },
  {
    key: 'server',
    displayName: 'aegis-server',
    description:
      'Host real: a máquina que executa esta instância do Aegis. Fica Não pareado até o operador gerar um código com `npm run demo:pairing-code` e executar o Aegis Collector nela.',
    simulated: false,
    services: [],
  },
];

type RuleSpec = Omit<DetectionRuleDetails, 'targetHostIds'> & { readonly key: 'service' | 'boot'; readonly targets: readonly DemoHostKey[] };

export const DEMO_RULES: readonly RuleSpec[] = [
  {
    key: 'service',
    name: 'Mudança em serviço crítico',
    description: 'Configuração de exemplo: mudança de estado em sshd, nginx ou mysqld. O motor de detecção ainda não avalia regras.',
    severity: 'HIGH',
    enabled: true,
    eventCategory: 'SYSTEM',
    scope: 'ALL_HOSTS',
    targets: [],
    definition: {
      version: 1,
      match: 'ALL',
      conditions: [
        { field: 'system.eventType', operator: 'EQUALS', value: 'SERVICE_STATE_CHANGED' },
        { field: 'system.serviceName', operator: 'IN', value: ['sshd', 'nginx', 'mysqld'] },
      ],
    },
  },
  {
    key: 'boot',
    name: 'Reinicialização de servidor de produção',
    description: 'Configuração de exemplo: qualquer boot nos servidores web e de banco.',
    severity: 'MEDIUM',
    enabled: true,
    eventCategory: 'SYSTEM',
    scope: 'SELECTED_HOSTS',
    targets: ['web', 'db'],
    definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.eventType', operator: 'EQUALS', value: 'BOOT' }] },
  },
];

export const DEMO_INCIDENTS = [
  {
    key: 'db-boot',
    title: 'Boot inesperado em srv-db-01',
    description: 'Exemplo: o servidor de banco reiniciou fora da janela de manutenção. Registrado manualmente.',
    severity: 'CRITICAL',
    hosts: ['db'],
    rules: ['boot'],
    status: 'OPEN',
  },
  {
    key: 'nginx',
    title: 'nginx reiniciado fora da janela de manutenção',
    description: 'Exemplo: o serviço nginx parou e voltou em srv-web-01 durante a madrugada.',
    severity: 'HIGH',
    hosts: ['web'],
    rules: ['service'],
    status: 'INVESTIGATING',
  },
  {
    key: 'lab',
    title: 'VM de laboratório sem heartbeat',
    description: 'Exemplo: lab-vm-ubuntu ficou Offline; a VM é desligada fora do horário de testes.',
    severity: 'LOW',
    hosts: ['lab'],
    rules: [],
    status: 'RESOLVED',
  },
] as const;

export const DEMO_INVESTIGATION = {
  title: 'Reinicializações não planejadas na madrugada',
  description: 'Exemplo de investigação que agrupa dois incidentes com a mesma janela de horário.',
  incidents: ['db-boot', 'nginx'],
  conclusion: 'Hipótese preliminar: atualização automática de pacotes reiniciou serviços e o servidor de banco.',
} as const;

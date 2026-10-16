export type ComponentState = 'online' | 'offline' | 'checking' | 'not-configured';

export interface SystemComponent {
  readonly name: string;
  readonly state: ComponentState;
}

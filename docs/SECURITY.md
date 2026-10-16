# Segurança

## Escopo defensivo

Bathke Aegis monitora apenas máquinas próprias, de laboratório ou explicitamente
autorizadas. Toda coleta futura será explícita, documentada, auditável, visível,
configurável e removível.

## Threat model inicial

| Ativo | Ameaça | Mitigação atual / planejada |
| --- | --- | --- |
| Credenciais de usuários | vazamento, brute force | PLANNED: Argon2, rate limiting, mensagens genéricas |
| Tokens JWT | roubo, forja | PLANNED: segredo forte via env, expiração curta |
| Banco MySQL | acesso direto | CURRENT: porta 3306 não publicada; rede `aegis_data` interna |
| API | exposição direta | CURRENT: somente Nginx publica porta |
| Telemetria de hosts | coleta excessiva/privada | PLANNED: allowlist de eventos, sem payload |
| Segredos no repositório | commit acidental | CURRENT: `.gitignore`, `.dockerignore`, MCP secret guard |
| Agentes de IA | leitura/exfiltração de segredos | CURRENT: AGENTS.md + MCP restrito |

## Segredos

- Somente `.env.example` (valores fictícios) é versionado.
- `compose.yaml` exige `MYSQL_PASSWORD`/`MYSQL_ROOT_PASSWORD` do ambiente; não há defaults de senha.
- Segredos nunca aparecem em logs, docs, fixtures, testes, commits, issues ou saída do MCP.
- `loadEnv` reporta apenas nomes de variáveis inválidas, nunca valores.

## Autenticação (planejada, Fase 02)

Hash Argon2id, JWT assinado com segredo de ambiente, ownership verificado no
servidor para toda escrita, email imutável via edição comum.

## Fronteiras

```
Internet/LAN ─► nginx (aegis_edge) ─► web/api (aegis_application, internal) ─► mysql (aegis_data, internal)
```

## Agent security

Agentes seguem `AGENTS.md`: não leem `.env`, `.env.*` (exceto `.env.example`),
`secrets/**`, `credentials/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.

## MCP security

- Sem ferramenta de shell arbitrário; apenas `npm run typecheck` e `npm run test` fixos.
- Leitura limitada a allowlist de diretórios; `resolveRepoPath` bloqueia traversal e caminhos protegidos.
- Saída de scripts passa por `redactSecrets`.
- `aegis_security_check` reporta arquivo/linha/regra, nunca o valor encontrado.

## Permissões futuras do collector

Executará com o mínimo necessário para carregar programas eBPF (capabilities
específicas como `CAP_BPF`/`CAP_PERFMON` em vez de root completo, quando possível),
como serviço visível e documentado, com desinstalação simples.

## Privacidade

Coleta de metadados (pid, ppid, executável, caminho, endereço/porta), nunca de
conteúdo: sem payload de rede, sem conteúdo de arquivos, sem teclado.

## Non-Goals

O projeto **não** implementa e não aceitará contribuições de:

- keylogging ou captura de entrada;
- captura de senhas ou roubo de credenciais;
- captura oculta de conteúdo privado / spyware;
- persistência maliciosa ou ocultação do agente;
- evasão de EDR/AV ou bypass de controles de segurança;
- exploração automatizada ou invasão de terceiros;
- execução remota não autorizada;
- criptografia própria.

## Workspace de demonstração e pareamento (planejado)

- **AEGIS DEMO:** somente dados gerados/curados; nenhuma telemetria real; acesso de visitantes preferencialmente somente leitura (ADR-012).
- **Pareamento:** token temporário com expiração curta, revogável, escopo limitado à ingestão de um workspace, armazenado apenas como hash e com auditoria de uso (ADR-013).

# Aegis Collector — CURRENT (BF 08)

Agente Linux em Rust, executado **explicitamente pelo usuário, em primeiro plano**. Pareia com um host
do Aegis por código de uso único, guarda a credencial de máquina em arquivo privado, envia heartbeat e
reporta eventos **SYSTEM** do Event Contract v1 por uma fila local persistente.

Não é instalado como serviço, não se esconde, não pede root, não usa eBPF e não executa nada recebido
do servidor. Passo a passo de demonstração em [`docs/LINUX_SETUP.md`](../../docs/LINUX_SETUP.md#aegis-collector--demonstração-no-fedora).

## Comandos

| Comando | O que faz |
| --- | --- |
| `aegis-collector pair --server <URL>` | Lê o código do painel **sem eco** (ou de uma linha da entrada padrão) e troca-o pela credencial do host. Recusa se já houver pareamento local. |
| `aegis-collector run [--once] [-v]` | Laço em primeiro plano: boot atual (uma vez), linha de base e mudanças de serviços systemd, heartbeat e envio da fila. `--once` faz um ciclo e sai. Encerra com Ctrl+C / SIGTERM. |
| `aegis-collector status` | Servidor, host, rótulo público da credencial (`aegis_agent_<8 hex>`), escopos, arquivos e fila. Nunca a credencial. |
| `aegis-collector replace-credential` | Instala a credencial exibida pelo painel após uma **rotação**, depois de validá-la com um heartbeat. |
| `aegis-collector unpair [--yes]` | Remove a configuração local. **Não revoga** a credencial no servidor (isso é feito no painel). |

Códigos e credenciais nunca são aceitos como argumentos (`--code`, `--token`… são recusados): ficariam no
histórico do shell e na lista de processos. Códigos de saída: `0` ok, `1` erro, `2` uso, `3` credencial
recusada (401), `4` sem permissão ou host divergente (403/404).

## Arquivos

| Caminho | Conteúdo | Proteção |
| --- | --- | --- |
| `$XDG_CONFIG_HOME/aegis-collector/config.json` (padrão `~/.config/…`) | servidor, workspace, host, id e **credencial** | diretório `0700`, arquivo `0600`, dono = usuário, links simbólicos recusados, gravação atômica sem sobrescrever |
| `$XDG_STATE_HOME/aegis-collector/hosts/<hostId>/spool.sqlite3` (padrão `~/.local/state/…`) | fila de eventos e estado (último boot reportado, contadores) | mesmo modelo; **sem credencial** |
| `…/hosts/<hostId>/run.lock` | trava: um `run` por host e usuário | `flock` |

As permissões protegem contra **outros usuários locais sem privilégio**. Não protegem contra root nem
contra código executado pela própria conta. O arquivo **não é criptografado**.

## Coleta (somente SYSTEM)

- **`SYSTEM_BOOT`**: `boot_id` de `/proc/sys/kernel/random/boot_id` e `btime` de `/proc/stat`.
  `sourceEventId` é UUID v5 do `boot_id` (estável); `occurredAt` é a hora do boot em RFC 3339 UTC. O
  boot é enfileirado **uma vez**: o evento e o registro "boot X reportado" são gravados na mesma transação.
- **`SYSTEM_SERVICE_STATE_CHANGED`**: `/usr/bin/systemctl list-units --type=service --all --plain
  --no-legend --no-pager --quiet` a cada 15 s — caminho absoluto, argumentos fixos, sem shell, ambiente
  limpo, timeout de 10 s e saída limitada a 4 MiB. Só nome da unidade e `ActiveState` são lidos
  (descrições não). Mapeamento: `active`/`reloading`/`refreshing` → RUNNING, `activating` → STARTING,
  `deactivating` → STOPPING, `inactive`/`maintenance` → STOPPED, `failed` → FAILED. A primeira leitura de
  cada execução é a **linha de base** (sem eventos); depois, só mudanças. Unidade que sai da lista é
  STOPPED; consulta que falha não gera nada. `occurredAt` é a hora da observação (precisão = intervalo).
  Mudanças ocorridas com o Collector parado não são reportadas. Sem systemd, a coleta de serviços é
  desativada com aviso e o resto continua.

Nunca coletado: linhas de comando, argumentos, ambiente, conteúdo de arquivos ou logs, mensagens,
teclas, senhas, tráfego de rede. Nada de eventos PROCESS ou NETWORK.

## Fila, envio e retries

- SQLite em WAL com `synchronous=FULL`: o que foi enfileirado sobrevive a encerramento abrupto,
  reinicialização e indisponibilidade da API.
- Limites: 10 000 eventos e 16 MiB. Cheia, a fila **recusa** eventos novos (nunca descarta os
  antigos), registra aviso e conta as recusas (`status`). Não há expiração por idade: a API aceita
  eventos antigos e os limites acima já limitam o disco.
- Lotes de até 100 eventos, na ordem observada; o `sourceEventId` nunca muda entre tentativas.
  Só o que a API confirmou (2xx com `received` igual ao lote) sai da fila.

| Resposta | Comportamento |
| --- | --- |
| 2xx | remove o lote confirmado |
| 401 | interrompe a transmissão (exit 3); eventos preservados |
| 403 | ingestão: interrompe (exit 4); heartbeat: desativa só o heartbeat e orienta a rotacionar |
| 404 | interrompe (exit 4): host configurado não corresponde à credencial |
| 409 / 400 | coloca em quarentena só os eventos apontados (ou o lote), mantidos para inspeção; sem retry infinito |
| 413 | reduz o lote pela metade; um evento sozinho vai para quarentena |
| 429 | espera `Retry-After` (ou backoff) |
| 5xx, rede, TLS | backoff exponencial com jitter (2 s … 5 min) |

## Transporte

`ureq` + `rustls`, raízes de confiança **do sistema operacional** (`rustls-platform-verifier`); não há
opção para desativar a verificação TLS. HTTPS obrigatório para servidores remotos; HTTP só em loopback.
URL sem usuário/senha, query ou fragmento. Redirecionamentos não são seguidos. Timeout de conexão 5 s,
por chamada 20 s; respostas acima de 64 KiB são recusadas sem leitura.

## Desenvolvimento

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build --release
```

Dependências: `ureq`, `rusqlite` (SQLite embutido), `serde`/`serde_json`, `uuid`, `rpassword`, `libc`,
`getrandom`; `tempfile` só nos testes. Testes usam fixtures de `/proc`, um `systemctl` falso e um servidor
HTTP local — nenhum serviço da máquina de CI é necessário.

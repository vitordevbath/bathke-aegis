# Ambiente Linux

Plataforma de referência: **Fedora KDE 44, x86_64, SELinux em modo Enforcing.**
As seções abaixo indicam o que foi **validado** nesta plataforma e o que é **PLANEJADO**
para fases futuras. Outras distribuições devem funcionar com os pacotes equivalentes,
mas não são validadas.

> Nunca desabilite o SELinux para "fazer funcionar". Se um componente precisar de
> permissão específica, trate com política/rótulo adequados e registre em `docs/DECISIONS.md`.

## Aegis Core — validado

| Ferramenta | Instalação (Fedora) | Verificação |
| --- | --- | --- |
| Git | `sudo dnf install git` | `git --version` |
| Node.js ≥ 22 + npm | gerenciador de versões (ex.: fnm) ou `sudo dnf install nodejs` | `node -v && npm -v` |
| Docker Engine + Compose v2 | repositório oficial Docker CE para Fedora (`docker-ce`, `docker-compose-plugin`) | `docker info && docker compose version` |

Validação do Core:

```bash
npm ci
npm run typecheck && npm run build && npm test

cp .env.example .env          # depois substitua TODOS os valores change-me
                              # JWT_SECRET: openssl rand -base64 48 (placeholder é rejeitado)
docker compose config --quiet # --quiet: a saída completa imprime as senhas interpoladas
docker compose up -d --build  # o serviço one-shot `migrate` aplica as migrations antes da API
docker compose ps
curl http://localhost:8080/api/health   # {"status":"ok","service":"aegis-api"}
docker compose down
```

Testes de integração com MySQL real (opcional localmente; sempre no CI): suba um MySQL
descartável preso a `127.0.0.1` e exporte `TEST_DATABASE_URL` com um usuário que possa criar
bancos antes de `npm test`. Sem a variável, esses testes são pulados.

Somente o `nginx` publica porta no host (`8080`, configurável por `AEGIS_HTTP_PORT`). `api`, `web` e `mysql` ficam em redes
internas. Para gerar senhas locais sem exibi-las: `openssl rand -hex 24`.

Teste automatizado da infraestrutura (também roda no CI):

```bash
npm run test:infra   # stack isolada `aegis-infra-test` na porta 18080; não toca a stack de dev nem lê .env
```

Ele constrói e sobe a stack do zero, verifica migrations, Nginx (`/`, `/api/`, headers, CSP),
portas publicadas, redes, isolamento e persistência do volume, e sempre executa `down -v`
**somente** no projeto de teste, inclusive em falha.

## Aegis Collector — demonstração no Fedora

Validado no Fedora KDE 44 (x86_64, SELinux Enforcing, systemd 259) contra a stack Docker local.
Tudo roda como **usuário comum**: sem root, sem `sudo`, sem desativar SELinux, sem mexer no
firewall, sem instalar serviço e sem eBPF. O Collector só funciona enquanto você o executa.

### 1. Requisitos

| Ferramenta | Instalação (Fedora) | Verificação |
| --- | --- | --- |
| rustup + Rust stable (≥ 1.85) | instalador oficial do rustup (escopo do usuário) | `cargo --version` |
| GCC (compila o SQLite embutido) | `sudo dnf install gcc` (já presente na maioria das instalações) | `gcc --version` |
| Aegis Core em execução | seção [Aegis Core](#aegis-core--validado) acima | `curl http://localhost:8080/api/health` |

### 2. Compilar o Collector

```bash
cd native/aegis-collector
cargo build --release                 # gera target/release/aegis-collector (binário único, ~5 MB)
./target/release/aegis-collector --version
```

Para não digitar o caminho, use `alias aegis-collector="$PWD/target/release/aegis-collector"` na sessão.
Nada é copiado para diretórios do sistema.

### 3. Subir a stack

```bash
cd ../..                              # raiz do repositório
docker compose up -d --build          # constrói as imagens e aplica as migrations (0000–0011) antes da API
docker compose ps                     # nginx, web, api e mysql "Up"; migrate "Exited (0)"
curl http://localhost:8080/api/health # {"status":"ok","service":"aegis-api"}
```

Nunca use `docker compose down -v` na stack de desenvolvimento: `-v` apaga o volume do MySQL.

### 4. Acessar o painel

Abra `http://localhost:8080`, crie uma conta em **Cadastro** e entre. O workspace pessoal é criado
automaticamente.

### 5. Criar o host

**Hosts → Adicionar host**, informe um nome (ex.: `fedora-estacao`). O host nasce **Não pareado**.

### 6. Gerar o código de pareamento

No detalhe do host, em **Pareamento do Collector**, clique em **Parear Collector**. O código
(`aegis_pair_…`) aparece **uma única vez**, vale 10 minutos e o painel mostra o comando exato. Para
desistir, **Cancelar código** invalida-o na hora (uma credencial já emitida não é afetada).

### 7. Parear

```bash
aegis-collector pair --server http://localhost:8080
# Código de pareamento (não será exibido):   ← cole o código e tecle Enter
```

O código é lido do terminal **sem eco** e nunca é aceito como argumento (ficaria no histórico do
shell). O servidor devolve a credencial de máquina do host, gravada em
`~/.config/aegis-collector/config.json` com permissão `0600` (diretório `0700`). Confira sem expor
o segredo:

```bash
aegis-collector status                # servidor, host, aegis_agent_<8 hex>, escopos, arquivos e fila
stat -c '%a %n' ~/.config/aegis-collector ~/.config/aegis-collector/config.json   # 700 e 600
```

Servidores remotos exigem `https://` com certificado válido para o sistema; `http://` só é aceito
para `localhost`, `127.0.0.0/8` e `::1`.

### 8. Executar o Collector

```bash
aegis-collector run -v                # primeiro plano; Ctrl+C encerra preservando a fila
```

Ao iniciar ele registra o **boot atual** (uma vez por boot), lê a **linha de base** dos serviços
systemd e passa a enviar **heartbeat** a cada 30 s. `aegis-collector run --once` faz um único ciclo e
sai (útil para testar).

### 9. Ver o heartbeat

No detalhe do host, **Collector e telemetria** passa de "Pareado, sem comunicação" para **Online** sem
recarregar a página (atualização a cada 15 s) e mostra o **último heartbeat**. Sem heartbeat por 90 s o
host aparece como **Offline**.

### 10. Receber eventos

O `SYSTEM_BOOT` chega no primeiro ciclo. Para provocar uma mudança real de serviço sem privilégios,
consulte um serviço ativado sob demanda — a consulta só lê informações:

```bash
hostnamectl status > /dev/null       # ativa systemd-hostnamed.service (inactive → RUNNING)
```

Em até 15 s o log do Collector mostra `serviço systemd-hostnamed.service → RUNNING`; cerca de 30 s
depois o serviço encerra sozinho por inatividade e chega `→ STOPPED`.

### 11. Consultar no painel

**Eventos** lista `Inicialização do sistema` e `systemd-hostnamed.service → RUNNING/STOPPED`; o link
**Ver eventos deste host** no detalhe filtra pelo host. Eventos são somente leitura.

### 12. Revogar

Em **Pareamento do Collector → Revogar credencial**, confirme. A credencial vai para **Credenciais
anteriores** com a data de revogação e o host volta a **Não pareado**.

### 13. Depois da revogação

No próximo heartbeat (até 30 s) o Collector recebe 401, registra
`o servidor recusou a credencial deste host…`, para de transmitir e encerra com **código 3**. Nada
enviado com a credencial depois da revogação é aceito (ADR-045). Eventos pendentes ficam na fila
local. Para voltar a operar, gere um novo código e execute:

```bash
aegis-collector unpair                # remove a configuração local (pede confirmação); não revoga nada no servidor
aegis-collector pair --server http://localhost:8080
```

Após uma **rotação** (em vez de revogação), o painel exibe a nova credencial uma vez; instale-a com
`aegis-collector replace-credential` (validada com um heartbeat antes de ser gravada).

### O próprio servidor como host real do AEGIS DEMO (opcional)

O demo (ADR-052) já tem três hosts simulados. O host `aegis-server` é reservado para a máquina que
executa a stack, e só recebe dados se você parear o Collector nela. Na mesma máquina da stack:

```bash
docker compose exec api node apps/api/dist/cli/demo-pairing-code.js   # imprime o código uma vez (10 min)
aegis-collector pair --server http://localhost:8080                   # cole o código
aegis-collector run
```

Todas as contas veem o boot e o estado dos serviços desta máquina enquanto ela estiver pareada.
Para parar na hora:

```bash
docker compose exec api node apps/api/dist/cli/demo-revoke-server.js
aegis-collector unpair --yes
```

### Teste automatizado do mesmo fluxo

```bash
(cd native/aegis-collector && cargo build --release)
npm run test:collector-e2e            # stack isolada `aegis-collector-e2e` na porta 18081 + binário real + Chrome headless
```

Ele percorre autenticação → host → código → `pair` → `run --once` → ONLINE → `SYSTEM_BOOT` em `/events`
→ revogação → Collector recusado (exit 3), heartbeat e ingestão 401 → nada gravado depois, e verifica o
layout em 320–1280 px. Remove só o projeto de teste. Também roda no CI (job `collector-e2e`).

## eBPF — toolchain preparada, componente PLANEJADO

| Ferramenta | Instalação (Fedora) | Verificação |
| --- | --- | --- |
| clang / LLVM | `sudo dnf install clang llvm llvm-devel` | `clang --version && llvm-config --version` |
| bpftool | `sudo dnf install bpftool` | `bpftool version` |
| BTF do kernel em uso | fornecido pelo kernel Fedora | `ls /sys/kernel/btf/vmlinux` |
| Rust nightly + `rust-src`, bpf-linker, Aya | **PLANEJADO** — instalar quando a camada eBPF começar | `cargo install bpf-linker` |

Notas:

- O Aya usa CO-RE/BTF (`/sys/kernel/btf/vmlinux`); `kernel-devel` não é pré-requisito.
- Se algum dia `kernel-devel` for necessário, ele deve corresponder **exatamente** a
  `uname -r` (`/usr/src/kernels/$(uname -r)`). Os repositórios do Fedora mantêm apenas a
  versão mais recente; se o kernel em execução estiver atrás, atualize kernel e
  `kernel-devel` juntos e reinicie. Nunca instale um `kernel-devel` de outra versão.
- `kernel-headers` (headers de userspace) segue numeração própria e não precisa coincidir
  com o kernel em execução.
- Nenhum programa eBPF é carregado: o Collector atual não usa eBPF.

## Aegis Verified Core — toolchain validada, componente PLANEJADO

| Ferramenta | Instalação | Verificação |
| --- | --- | --- |
| GNAT (compilador Ada) | `sudo dnf install gcc-gnat` | `gnat --version` |
| Alire (`alr`) | binário oficial das [releases do Alire](https://github.com/alire-project/alire/releases) (`alr-<versão>-bin-x86_64-linux.zip`); confira o sha256 publicado e copie `bin/alr` para `~/.local/bin` | `alr --version` |
| GNATprove | `alr install gnatprove` (instala em `~/.alire`) | `gnatprove --version` |

O Fedora não empacota Alire nem GNATprove. Adicione o prefixo do Alire ao `PATH`, por exemplo
em `~/.bashrc.d/alire.sh`:

```bash
case ":$PATH:" in *":$HOME/.alire/bin:"*) ;; *) PATH="$HOME/.alire/bin:$PATH" ;; esac
```

O binário do GNATprove traz seus próprios provers (Alt-Ergo, cvc5, Z3) e funciona com o GNAT
do Fedora; a toolchain GNAT do Alire não é necessária para provar. Nenhuma prova formal do
projeto existe ainda.

## x86-64 / desempenho — toolchain validada, componente PLANEJADO

| Ferramenta | Instalação (Fedora) | Verificação |
| --- | --- | --- |
| NASM | `sudo dnf install nasm` | `nasm -v` |
| GCC + binutils | `sudo dnf install gcc binutils` | `ld --version && objdump --version && readelf --version` |
| perf | `sudo dnf install perf` | `perf --version` |

## Ambientes de validação

| Ambiente | Papel |
| --- | --- |
| Fedora KDE 44 (estação do desenvolvedor) | referência principal; demonstração real do Collector (BF 08) |
| VM Linux / VPS Linux / servidor controlado | validação completa |
| WSL2 | **opcional**, desenvolvimento e demonstração |

WSL2 é útil para demonstração e desenvolvimento, porém não representa
necessariamente o comportamento de uma instalação Linux física ou VPS —
principalmente rede, firewall, integração com o host Windows e
kernel/configurações específicas. Resultados obtidos em WSL2 não validam o Collector.

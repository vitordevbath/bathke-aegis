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

Somente o `nginx` publica porta no host (`8080`). `api`, `web` e `mysql` ficam em redes
internas. Para gerar senhas locais sem exibi-las: `openssl rand -hex 24`.

## Aegis Collector / eBPF — toolchain preparada, componente PLANEJADO

| Ferramenta | Instalação (Fedora) | Verificação |
| --- | --- | --- |
| rustup + Rust stable | instalador oficial do rustup (escopo do usuário) | `rustup show` |
| clang / LLVM | `sudo dnf install clang llvm llvm-devel` | `clang --version && llvm-config --version` |
| bpftool | `sudo dnf install bpftool` | `bpftool version` |
| BTF do kernel em uso | fornecido pelo kernel Fedora | `ls /sys/kernel/btf/vmlinux` |
| Rust nightly + `rust-src`, bpf-linker, Aya | **PLANEJADO** — instalar quando o Collector começar | `cargo install bpf-linker` |

Notas:

- O Aya usa CO-RE/BTF (`/sys/kernel/btf/vmlinux`); `kernel-devel` não é pré-requisito.
- Se algum dia `kernel-devel` for necessário, ele deve corresponder **exatamente** a
  `uname -r` (`/usr/src/kernels/$(uname -r)`). Os repositórios do Fedora mantêm apenas a
  versão mais recente; se o kernel em execução estiver atrás, atualize kernel e
  `kernel-devel` juntos e reinicie. Nunca instale um `kernel-devel` de outra versão.
- `kernel-headers` (headers de userspace) segue numeração própria e não precisa coincidir
  com o kernel em execução.
- Nenhum programa eBPF é carregado fora da fase do Collector.

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
| Fedora KDE 44 (estação do desenvolvedor) | referência principal |
| VM Linux / VPS Linux / servidor controlado | validação completa |
| WSL2 | **opcional**, desenvolvimento e demonstração |

WSL2 é útil para demonstração e desenvolvimento, porém não representa
necessariamente o comportamento de uma instalação Linux física ou VPS —
principalmente rede, firewall, integração com o host Windows e
kernel/configurações específicas. Resultados obtidos em WSL2 não validam o Collector.

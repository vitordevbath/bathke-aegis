# Ambiente Linux (Aegis Labs)

> **To be validated on Bathke Linux workstation.**
> Nada aqui foi instalado ou testado ainda. Nenhuma distribuição específica é assumida;
> use o gerenciador de pacotes da sua distribuição.

## Aegis Core

| Ferramenta | Uso | Verificação |
| --- | --- | --- |
| Git | versionamento | `git --version` |
| Node.js ≥ 22 + npm | web, api, MCP | `node -v && npm -v` |
| Docker Engine + Compose v2 | stack completa | `docker compose version` |

## Aegis Collector / eBPF

| Ferramenta | Uso | Verificação |
| --- | --- | --- |
| rustup / Rust stable + nightly | collector, Aya | `rustup show` |
| Cargo | build | `cargo --version` |
| bpf-linker | link de programas eBPF (Aya) | `cargo install bpf-linker` |
| clang / llvm | toolchain BPF | `clang --version` |
| kernel headers (do kernel em uso) | CO-RE/BTF | `ls /sys/kernel/btf/vmlinux` |
| bpftool (se necessário) | inspeção de programas/mapas | `bpftool version` |
| Aya | crates `aya`, `aya-ebpf` | via Cargo |

## Aegis Verified Core

| Ferramenta | Uso | Verificação |
| --- | --- | --- |
| GNAT (via Alire recomendado) | compilador Ada | `gnat --version` |
| SPARK + GNATprove | prova formal | `gnatprove --version` |

## x86-64

| Ferramenta | Uso | Verificação |
| --- | --- | --- |
| NASM | assembler | `nasm -v` |
| binutils | `ld`, `objdump` | `objdump --version` |
| perf | benchmarks | `perf --version` |

## Checklist

1. Clonar o repositório, `npm ci`, `npm run typecheck && npm run build && npm test`.
2. `cp .env.example .env`, ajustar senhas, `docker compose up -d --build`.
3. Instalar toolchains Labs conforme as fases 05, 06, 09 e 10.

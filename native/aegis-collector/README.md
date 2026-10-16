# Aegis Collector — PLANNED

Rust user-space agent for authorized Linux hosts.

Candidate responsibilities: receive events from `native/ebpf`, normalize, buffer,
batch, send authenticated batches to Aegis API, expose metrics and health state.

Principles: explicit, documented, auditable, visible, configurable, removable.
No hidden operation, no persistence tricks. Phase 05.

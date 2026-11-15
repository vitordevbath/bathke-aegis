//! `aegis-collector run`: the foreground loop. It reports the current boot
//! once, watches systemd service states, sends a heartbeat and drains the
//! local queue. It stops on SIGINT/SIGTERM, or for good when the server
//! refuses the credential. It accepts no instructions from the server.

use std::fs::OpenOptions;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use uuid::Uuid;

use crate::boot::read_boot_info;
use crate::config::CollectorConfig;
use crate::delivery::{DEFAULT_HEARTBEAT_INTERVAL, Deliverer, Fatal, FlushOutcome, HeartbeatVerdict, classify_heartbeat};
use crate::event::{SystemEvent, SystemEventKind};
use crate::http::{MachineApi, MachineTransport};
use crate::logger::Logger;
use crate::paths::Paths;
use crate::secure_fs;
use crate::services::{ServiceTracker, parse_list_units};
use crate::spool::{BootOutcome, DEFAULT_LIMITS, EnqueueOutcome, Spool, SpoolLimits};
use crate::systemctl;
use crate::time::rfc3339_utc;

#[derive(Clone, Debug)]
pub enum SystemdSource {
    /// Use the running systemd, if any (`/run/systemd/system` and `/usr/bin/systemctl`).
    Detect,
    /// Tests: a program that prints `systemctl list-units` output.
    Program(PathBuf),
    Disabled,
}

#[derive(Clone, Debug)]
pub struct RunOptions {
    pub proc_root: PathBuf,
    pub systemd: SystemdSource,
    /// One cycle (boot, service baseline, heartbeat, flush), then exit.
    pub once: bool,
    pub service_poll_interval: Duration,
    pub flush_interval: Duration,
    pub spool_limits: SpoolLimits,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            proc_root: PathBuf::from("/proc"),
            systemd: SystemdSource::Detect,
            once: false,
            service_poll_interval: Duration::from_secs(15),
            flush_interval: Duration::from_secs(5),
            spool_limits: DEFAULT_LIMITS,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum RunExit {
    /// Stopped by a signal.
    Stopped,
    /// `--once` finished its cycle.
    Completed,
    /// The server refused to continue; see the log for what to do.
    Fatal(Fatal),
}

/// Holds an exclusive `flock` for the lifetime of the run: one Collector per host and user.
struct RunLock {
    /// Kept open: closing the descriptor releases the lock.
    _file: std::fs::File,
}

fn lock_host(dir: &Path) -> Result<RunLock, String> {
    let path = dir.join("run.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    // SAFETY: valid open descriptor; flock has no memory-safety preconditions.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("já existe um aegis-collector em execução para este host".into());
    }
    Ok(RunLock { _file: file })
}

fn now_text() -> String {
    rfc3339_utc(SystemTime::now())
}

struct Collector<'a> {
    log: &'a Logger,
    spool: Spool,
    api: MachineApi,
    systemctl: Option<PathBuf>,
    tracker: ServiceTracker,
    deliverer: Deliverer,
}

impl Collector<'_> {
    fn record_error(&self, message: &str) {
        let _ = self.spool.set_state("last_error", &format!("{} {message}", now_text()));
    }

    fn report_boot(&mut self, proc_root: &Path) {
        match read_boot_info(proc_root) {
            Ok(boot) => {
                let event = boot.to_event(&now_text());
                match self.spool.enqueue_boot_once(&boot, &event, &now_text()) {
                    Ok(BootOutcome::Queued) => {
                        self.log.info(&format!("boot atual registrado na fila (boot_id {}, iniciado em {})", boot.boot_id, event.occurred_at))
                    }
                    Ok(BootOutcome::AlreadyReported) => self.log.debug("boot atual já havia sido registrado"),
                    Ok(BootOutcome::Full) => self.log.warn("fila local cheia: o boot atual será registrado quando houver espaço"),
                    Err(error) => self.log.error(&error.to_string()),
                }
            }
            Err(error) => self.log.warn(&format!("identificação do boot indisponível: {error}")),
        }
    }

    fn poll_services(&mut self) {
        let Some(program) = self.systemctl.clone() else { return };
        let output = match systemctl::list_service_units(&program) {
            Ok(output) => output,
            Err(error) => {
                // A failed query is not "every service stopped": keep the baseline and try again later.
                self.log.warn(&format!("consulta de serviços falhou ({error}); nenhuma mudança foi inferida"));
                return;
            }
        };
        let first = !self.tracker.has_baseline();
        let changes = self.tracker.observe(parse_list_units(&output));
        if first {
            self.log.info(&format!("linha de base de serviços: {} serviço(s) observado(s); apenas mudanças serão reportadas", self.tracker.tracked()));
        }
        let observed_at = now_text();
        for (service_name, state) in changes {
            let event = SystemEvent {
                source_event_id: Uuid::new_v4(),
                occurred_at: observed_at.clone(),
                kind: SystemEventKind::ServiceStateChanged { service_name: service_name.clone(), state },
            };
            match self.spool.enqueue(&event, &observed_at) {
                Ok(EnqueueOutcome::Queued | EnqueueOutcome::AlreadyQueued) => self.log.info(&format!("serviço {service_name} → {}", state.as_str())),
                Ok(EnqueueOutcome::Full) => {
                    let dropped = self.spool.stats().map(|s| s.dropped).unwrap_or(0);
                    self.log.warn(&format!(
                        "fila local cheia: mudança de {service_name} → {} NÃO foi registrada ({dropped} evento(s) recusado(s) até agora)",
                        state.as_str()
                    ));
                }
                Err(error) => self.log.error(&error.to_string()),
            }
        }
    }

    fn heartbeat(&mut self) -> HeartbeatVerdict {
        let verdict = classify_heartbeat(self.api.heartbeat());
        match &verdict {
            HeartbeatVerdict::Recorded { .. } => {
                let _ = self.spool.set_state("last_heartbeat_at", &now_text());
                self.log.debug("heartbeat aceito");
            }
            HeartbeatVerdict::NotAllowed => self.log.warn(
                "esta credencial não tem o escopo host:heartbeat (emitida antes do heartbeat existir). Os eventos continuam sendo enviados; \
                 para habilitar o heartbeat, rotacione a credencial no painel e execute `aegis-collector replace-credential`.",
            ),
            HeartbeatVerdict::RateLimited(_) => self.log.warn("heartbeat limitado pela API; nova tentativa mais tarde"),
            HeartbeatVerdict::Retry(reason) => {
                self.log.warn(&format!("heartbeat falhou ({reason}); nova tentativa no próximo intervalo"));
                self.record_error(&format!("heartbeat: {reason}"));
            }
            HeartbeatVerdict::Fatal(_) => {}
        }
        verdict
    }

    fn flush(&mut self) -> FlushOutcome {
        match self.deliverer.flush(&mut self.spool, &self.api, self.log) {
            Ok(outcome) => {
                if matches!(outcome, FlushOutcome::Drained { .. } | FlushOutcome::Later { delivered: 1.., .. }) {
                    let _ = self.spool.set_state("last_delivery_at", &now_text());
                }
                if let FlushOutcome::Drained { delivered } | FlushOutcome::Later { delivered: delivered @ 1.., .. } = outcome {
                    self.log.info(&format!("{delivered} evento(s) entregue(s) e confirmado(s) pela API"));
                }
                outcome
            }
            Err(error) => {
                self.log.error(&error.to_string());
                FlushOutcome::Later { delivered: 0, delay: Duration::from_secs(30) }
            }
        }
    }

    fn stop(&self, fatal: Fatal) -> RunExit {
        let pending = self.spool.stats().map(|s| s.pending).unwrap_or(0);
        let message = match fatal {
            Fatal::CredentialRejected => format!(
                "o servidor recusou a credencial deste host (revogada, rotacionada ou inválida). Transmissão interrompida; {pending} evento(s) \
                 permanecem na fila local. Se ela foi rotacionada, use `aegis-collector replace-credential`; se foi revogada, gere um novo \
                 código no painel e execute `aegis-collector unpair` seguido de `aegis-collector pair`."
            ),
            Fatal::Forbidden => format!("a credencial não permite enviar eventos (HTTP 403). Transmissão interrompida; {pending} evento(s) preservados."),
            Fatal::HostMismatch => {
                format!("o host configurado não corresponde à credencial (HTTP 404). Transmissão interrompida; {pending} evento(s) preservados.")
            }
        };
        self.log.error(&message);
        self.record_error(&format!("{fatal:?}"));
        RunExit::Fatal(fatal)
    }
}

fn sleep_until(deadline: Instant, shutdown: &AtomicBool) {
    while !shutdown.load(Ordering::SeqCst) {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        thread::sleep((deadline - now).min(Duration::from_millis(250)));
    }
}

pub fn run(paths: &Paths, options: &RunOptions, log: &Logger, shutdown: &AtomicBool) -> Result<RunExit, String> {
    let config = CollectorConfig::load(paths)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "este usuário não tem Collector pareado; execute `aegis-collector pair --server <URL>`".to_string())?;
    let host_dir = paths.host_state_dir(&config.host_id);
    secure_fs::ensure_private_dir(&host_dir).map_err(|e| e.to_string())?;
    let _lock = lock_host(&host_dir)?;
    let spool = Spool::open(&paths.spool_file(&config.host_id), options.spool_limits).map_err(|e| e.to_string())?;

    let systemctl = match &options.systemd {
        SystemdSource::Detect => systemctl::locate(Path::new("/")),
        SystemdSource::Program(path) => Some(path.clone()),
        SystemdSource::Disabled => None,
    };
    log.info(&format!(
        "Aegis Collector {} iniciado em primeiro plano: servidor {}, host {}, credencial {}. Coleta: SYSTEM (boot{}). \
         Sem linhas de comando, ambiente, conteúdo de arquivos, logs ou rede. Nenhuma instrução do servidor é executada.",
        crate::VERSION,
        config.server,
        config.host_id,
        config.credential_label(),
        if systemctl.is_some() { " e estados de serviços systemd" } else { "" }
    ));
    if systemctl.is_none() {
        log.warn("systemd não disponível: a observação de serviços está desativada; boot e heartbeat continuam");
    }

    let mut collector = Collector { log, api: MachineApi::new(&config), spool, systemctl, tracker: ServiceTracker::default(), deliverer: Deliverer::default() };
    collector.report_boot(&options.proc_root);
    collector.poll_services();

    if options.once {
        if let HeartbeatVerdict::Fatal(fatal) = collector.heartbeat() {
            return Ok(collector.stop(fatal));
        }
        loop {
            match collector.flush() {
                FlushOutcome::Idle | FlushOutcome::Drained { .. } => break,
                FlushOutcome::Stop(fatal) => return Ok(collector.stop(fatal)),
                FlushOutcome::Later { delay, .. } if delay.is_zero() => continue,
                FlushOutcome::Later { .. } => {
                    log.warn("eventos pendentes permanecem na fila local para a próxima execução");
                    break;
                }
            }
        }
        return Ok(RunExit::Completed);
    }

    let start = Instant::now();
    let mut heartbeat_enabled = true;
    let mut heartbeat_interval = DEFAULT_HEARTBEAT_INTERVAL;
    let (mut next_heartbeat, mut next_poll, mut next_flush) = (start, start + options.service_poll_interval, start);
    while !shutdown.load(Ordering::SeqCst) {
        let now = Instant::now();
        if heartbeat_enabled && now >= next_heartbeat {
            next_heartbeat = match collector.heartbeat() {
                HeartbeatVerdict::Recorded { interval } => {
                    heartbeat_interval = interval;
                    now + interval
                }
                HeartbeatVerdict::Fatal(fatal) => return Ok(collector.stop(fatal)),
                HeartbeatVerdict::NotAllowed => {
                    heartbeat_enabled = false;
                    now
                }
                HeartbeatVerdict::RateLimited(retry_after) => now + retry_after.unwrap_or(heartbeat_interval),
                HeartbeatVerdict::Retry(_) => now + heartbeat_interval,
            };
        }
        if collector.systemctl.is_some() && now >= next_poll {
            collector.poll_services();
            next_poll = now + options.service_poll_interval;
        }
        if now >= next_flush {
            next_flush = match collector.flush() {
                FlushOutcome::Idle | FlushOutcome::Drained { .. } => now + options.flush_interval,
                FlushOutcome::Later { delay, .. } => now + delay,
                FlushOutcome::Stop(fatal) => return Ok(collector.stop(fatal)),
            };
        }
        let mut wake = next_flush;
        if heartbeat_enabled {
            wake = wake.min(next_heartbeat);
        }
        if collector.systemctl.is_some() {
            wake = wake.min(next_poll);
        }
        sleep_until(wake, shutdown);
    }
    let pending = collector.spool.stats().map(|s| s.pending).unwrap_or(0);
    log.info(&format!("encerrando a pedido do sistema; {pending} evento(s) pendente(s) preservado(s) na fila local"));
    Ok(RunExit::Stopped)
}

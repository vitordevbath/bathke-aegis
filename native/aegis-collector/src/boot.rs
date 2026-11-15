//! Identifies the current Linux boot from kernel-provided sources:
//! `/proc/sys/kernel/random/boot_id` (a random UUID chosen at each boot) and
//! `btime` in `/proc/stat` (boot time, seconds since the epoch). Both are read
//! from a configurable root so tests use fixtures instead of the real `/proc`.

use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::event::{SystemEvent, SystemEventKind};
use crate::time::rfc3339_from_unix_seconds;

/// Fixed namespace for name-based ids of Collector facts (UUID v5).
const AEGIS_COLLECTOR_NAMESPACE: Uuid = Uuid::from_u128(0x6f1d_3c2a_8b4e_4f6a_9d21_7e5c_0a3b_9c14);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BootInfo {
    pub boot_id: Uuid,
    /// Seconds since the epoch; None when `/proc/stat` has no usable `btime`.
    pub boot_time: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum BootError {
    Unreadable(String),
    Malformed(&'static str),
}

impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable(source) => write!(f, "não foi possível ler {source}"),
            Self::Malformed(source) => write!(f, "conteúdo inesperado em {source}"),
        }
    }
}

impl std::error::Error for BootError {}

const BOOT_ID: &str = "sys/kernel/random/boot_id";
const STAT: &str = "stat";
/// `/proc` files are tiny; anything larger is not what we expect.
const MAX_PROC_FILE: u64 = 1024 * 1024;

fn read_small(path: &Path) -> Result<String, BootError> {
    let metadata = fs::metadata(path).map_err(|_| BootError::Unreadable(path.display().to_string()))?;
    // procfs reports size 0; a regular fixture file is checked against the cap.
    if metadata.len() > MAX_PROC_FILE {
        return Err(BootError::Malformed("arquivo grande demais"));
    }
    fs::read_to_string(path).map_err(|_| BootError::Unreadable(path.display().to_string()))
}

pub fn read_boot_info(proc_root: &Path) -> Result<BootInfo, BootError> {
    let raw_id = read_small(&proc_root.join(BOOT_ID))?;
    let boot_id = Uuid::parse_str(raw_id.trim()).map_err(|_| BootError::Malformed("boot_id"))?;
    let boot_time = read_small(&proc_root.join(STAT)).ok().and_then(|stat| parse_btime(&stat));
    Ok(BootInfo { boot_id, boot_time })
}

/// The `btime <seconds>` line of `/proc/stat`.
pub fn parse_btime(stat: &str) -> Option<u64> {
    stat.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        (parts.next() == Some("btime")).then(|| parts.next()?.parse::<u64>().ok()).flatten().filter(|s| *s > 0)
    })
}

impl BootInfo {
    /// The same boot always yields the same `sourceEventId`, so even a lost
    /// local state cannot make the API store a boot twice.
    pub fn source_event_id(&self) -> Uuid {
        Uuid::new_v5(&AEGIS_COLLECTOR_NAMESPACE, format!("system-boot/{}", self.boot_id).as_bytes())
    }

    /// `occurredAt` is the kernel's boot time; without it, the time the boot was first observed.
    pub fn to_event(&self, observed_at: &str) -> SystemEvent {
        let occurred_at = self.boot_time.map(rfc3339_from_unix_seconds).unwrap_or_else(|| observed_at.to_string());
        SystemEvent { source_event_id: self.source_event_id(), occurred_at, kind: SystemEventKind::Boot }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(boot_id: &str, stat: &str) -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("sys/kernel/random")).unwrap();
        fs::write(root.path().join(BOOT_ID), boot_id).unwrap();
        fs::write(root.path().join(STAT), stat).unwrap();
        root
    }

    const STAT_FIXTURE: &str = "cpu  1 2 3 4\ncpu0 1 2 3 4\nintr 10\nctxt 99\nbtime 1794765139\nprocesses 4242\nprocs_running 2\n";

    #[test]
    fn reads_the_boot_id_and_boot_time() {
        let root = fixture("f9e36ab6-e956-410b-85b5-6abe8bd86f96\n", STAT_FIXTURE);
        let info = read_boot_info(root.path()).unwrap();
        assert_eq!(info.boot_id.to_string(), "f9e36ab6-e956-410b-85b5-6abe8bd86f96");
        assert_eq!(info.boot_time, Some(1_794_765_139));
    }

    #[test]
    fn boot_event_uses_the_kernel_boot_time_in_utc_and_a_stable_id() {
        let root = fixture("f9e36ab6-e956-410b-85b5-6abe8bd86f96", STAT_FIXTURE);
        let info = read_boot_info(root.path()).unwrap();
        let first = info.to_event("2026-11-15T18:00:00.000Z");
        let again = read_boot_info(root.path()).unwrap().to_event("2026-11-15T19:00:00.000Z");
        assert_eq!(first.occurred_at, "2026-11-15T17:52:19.000Z");
        assert_eq!(first.source_event_id, again.source_event_id);
        assert_eq!(first, again);
        assert_eq!(first.source_event_id.get_version_num(), 5);
    }

    #[test]
    fn different_boots_get_different_ids() {
        let a = read_boot_info(fixture("f9e36ab6-e956-410b-85b5-6abe8bd86f96", STAT_FIXTURE).path()).unwrap();
        let b = read_boot_info(fixture("0b1f8d3e-1111-4222-8333-444455556666", STAT_FIXTURE).path()).unwrap();
        assert_ne!(a.source_event_id(), b.source_event_id());
    }

    #[test]
    fn falls_back_to_the_observation_time_without_btime() {
        let root = fixture("f9e36ab6-e956-410b-85b5-6abe8bd86f96", "cpu 1 2 3\n");
        let info = read_boot_info(root.path()).unwrap();
        assert_eq!(info.boot_time, None);
        assert_eq!(info.to_event("2026-11-15T18:00:00.000Z").occurred_at, "2026-11-15T18:00:00.000Z");
    }

    #[test]
    fn refuses_a_malformed_or_missing_boot_id() {
        assert_eq!(read_boot_info(fixture("nao-e-uuid", STAT_FIXTURE).path()), Err(BootError::Malformed("boot_id")));
        let empty = tempfile::tempdir().unwrap();
        assert!(matches!(read_boot_info(empty.path()), Err(BootError::Unreadable(_))));
        assert_eq!(parse_btime("btime abc\n"), None);
        assert_eq!(parse_btime("btime 0\n"), None);
    }

    #[test]
    fn reads_the_real_proc_when_available() {
        if Path::new("/proc/sys/kernel/random/boot_id").exists() {
            let info = read_boot_info(Path::new("/proc")).unwrap();
            assert!(info.boot_time.is_some());
        }
    }
}

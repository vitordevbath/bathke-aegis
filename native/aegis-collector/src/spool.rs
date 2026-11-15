//! Persistent, bounded local queue of events waiting for the API (SQLite).
//!
//! - Durable: WAL with `synchronous=FULL`, so an event that was enqueued
//!   survives a crash, a power loss or a reboot.
//! - Idempotent: an event's `sourceEventId` is fixed when it is enqueued and
//!   never changes; a retry sends the exact same fact and the API deduplicates.
//! - Confirmed removal: rows leave the queue only after the API accepted them.
//! - Bounded: at most `max_events` rows and `max_bytes` of payload. A full
//!   queue refuses new events (never drops queued ones) and counts every
//!   refusal in `dropped_events`, which `status` and the log report.
//! - No secrets: the credential is never written here.

use std::fmt;
use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde_json::Value;

use crate::boot::BootInfo;
use crate::event::{SystemEvent, envelope};
use crate::secure_fs::{self, SecureFsError};

pub const SCHEMA_VERSION: i64 = 1;
/// Per-row overhead counted towards the size limit, besides the payload.
const ROW_OVERHEAD_BYTES: i64 = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpoolLimits {
    pub max_events: i64,
    pub max_bytes: i64,
}

/// Thousands of SYSTEM events are days of a noisy host offline; 16 MiB is small on any disk.
pub const DEFAULT_LIMITS: SpoolLimits = SpoolLimits { max_events: 10_000, max_bytes: 16 * 1024 * 1024 };

#[derive(Debug)]
pub enum SpoolError {
    Fs(SecureFsError),
    Sqlite(rusqlite::Error),
    UnknownSchema(i64),
}

impl fmt::Display for SpoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fs(error) => write!(f, "fila local: {error}"),
            Self::Sqlite(error) => write!(f, "fila local (SQLite): {error}"),
            Self::UnknownSchema(version) => write!(f, "fila local com esquema desconhecido ({version})"),
        }
    }
}

impl std::error::Error for SpoolError {}

impl From<rusqlite::Error> for SpoolError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<SecureFsError> for SpoolError {
    fn from(error: SecureFsError) -> Self {
        Self::Fs(error)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Queued,
    /// The same `sourceEventId` is already queued.
    AlreadyQueued,
    /// The queue is at its limit; the event was not stored and was counted as dropped.
    Full,
}

#[derive(Debug, PartialEq, Eq)]
pub enum BootOutcome {
    Queued,
    /// This boot was already enqueued in an earlier run.
    AlreadyReported,
    Full,
}

/// A queued event, ready to be sent as is.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingEvent {
    pub seq: i64,
    pub source_event_id: String,
    pub body: Value,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SpoolStats {
    pub pending: i64,
    pub quarantined: i64,
    pub bytes: i64,
    pub dropped: i64,
}

pub struct Spool {
    conn: Connection,
    limits: SpoolLimits,
}

const STATE_LAST_BOOT: &str = "last_boot_id";
const STATE_DROPPED: &str = "dropped_events";

impl Spool {
    /// Opens (creating if needed) the queue in a private directory and file.
    pub fn open(path: &Path, limits: SpoolLimits) -> Result<Self, SpoolError> {
        if let Some(dir) = path.parent() {
            secure_fs::ensure_private_dir(dir)?;
        }
        // Created 0600 first: SQLite gives its -wal and -shm files the database file's mode.
        secure_fs::ensure_private_file(path)?;
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        match version {
            0 => {
                conn.execute_batch(
                    "BEGIN;
                     CREATE TABLE spool_events (
                       seq INTEGER PRIMARY KEY AUTOINCREMENT,
                       source_event_id TEXT NOT NULL UNIQUE,
                       occurred_at TEXT NOT NULL,
                       category TEXT NOT NULL,
                       event_type TEXT NOT NULL,
                       data TEXT NOT NULL,
                       created_at TEXT NOT NULL,
                       attempts INTEGER NOT NULL DEFAULT 0,
                       status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUARANTINED')),
                       last_error TEXT
                     );
                     CREATE INDEX spool_events_status_seq ON spool_events (status, seq);
                     CREATE TABLE collector_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                     PRAGMA user_version = 1;
                     COMMIT;",
                )?;
            }
            SCHEMA_VERSION => {}
            other => return Err(SpoolError::UnknownSchema(other)),
        }
        Ok(Self { conn, limits })
    }

    fn row_size(event: &SystemEvent, data: &str) -> i64 {
        (data.len() + event.occurred_at.len() + event.event_type().len()) as i64 + ROW_OVERHEAD_BYTES
    }

    fn has_room(tx: &rusqlite::Transaction<'_>, limits: SpoolLimits, size: i64) -> Result<bool, SpoolError> {
        let (count, bytes): (i64, i64) = tx.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data) + LENGTH(occurred_at) + LENGTH(event_type) + ?1), 0) FROM spool_events",
            params![ROW_OVERHEAD_BYTES],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(count < limits.max_events && bytes + size <= limits.max_bytes)
    }

    fn insert(tx: &rusqlite::Transaction<'_>, event: &SystemEvent, data: &str, created_at: &str) -> Result<bool, SpoolError> {
        let inserted = tx.execute(
            "INSERT INTO spool_events (source_event_id, occurred_at, category, event_type, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (source_event_id) DO NOTHING",
            params![event.source_event_id.to_string(), event.occurred_at, event.category(), event.event_type(), data, created_at],
        )?;
        Ok(inserted == 1)
    }

    fn count_dropped(tx: &rusqlite::Transaction<'_>) -> Result<(), SpoolError> {
        tx.execute(
            "INSERT INTO collector_state (key, value) VALUES (?1, '1')
             ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
            params![STATE_DROPPED],
        )?;
        Ok(())
    }

    pub fn enqueue(&mut self, event: &SystemEvent, created_at: &str) -> Result<EnqueueOutcome, SpoolError> {
        let data = event.data().to_string();
        let tx = self.conn.transaction()?;
        if !Self::has_room(&tx, self.limits, Self::row_size(event, &data))? {
            Self::count_dropped(&tx)?;
            tx.commit()?;
            return Ok(EnqueueOutcome::Full);
        }
        let outcome = if Self::insert(&tx, event, &data, created_at)? { EnqueueOutcome::Queued } else { EnqueueOutcome::AlreadyQueued };
        tx.commit()?;
        Ok(outcome)
    }

    /// Enqueues the boot event once per boot id: the event and the record of
    /// having enqueued it commit together, so a restart neither repeats nor loses it.
    /// A full queue leaves the boot unrecorded, so a later run tries again.
    pub fn enqueue_boot_once(&mut self, boot: &BootInfo, event: &SystemEvent, created_at: &str) -> Result<BootOutcome, SpoolError> {
        let boot_id = boot.boot_id.to_string();
        let data = event.data().to_string();
        let tx = self.conn.transaction()?;
        let last: Option<String> = tx.query_row("SELECT value FROM collector_state WHERE key = ?1", params![STATE_LAST_BOOT], |row| row.get(0)).optional()?;
        if last.as_deref() == Some(boot_id.as_str()) {
            return Ok(BootOutcome::AlreadyReported);
        }
        if !Self::has_room(&tx, self.limits, Self::row_size(event, &data))? {
            return Ok(BootOutcome::Full);
        }
        Self::insert(&tx, event, &data, created_at)?;
        tx.execute(
            "INSERT INTO collector_state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![STATE_LAST_BOOT, boot_id],
        )?;
        tx.commit()?;
        Ok(BootOutcome::Queued)
    }

    /// The oldest pending events, at most `max`, in the order they were observed.
    pub fn next_batch(&mut self, max: usize) -> Result<Vec<PendingEvent>, SpoolError> {
        let rows: Vec<(i64, String, String, String, String, String)> = {
            let mut statement = self.conn.prepare(
                "SELECT seq, source_event_id, occurred_at, category, event_type, data FROM spool_events WHERE status = 'PENDING' ORDER BY seq LIMIT ?1",
            )?;
            statement
                .query_map(params![max as i64], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))?
                .collect::<Result<_, _>>()?
        };
        let mut batch = Vec::with_capacity(rows.len());
        for (seq, source_event_id, occurred_at, category, event_type, data) in rows {
            match serde_json::from_str::<Value>(&data) {
                Ok(data) => batch.push(PendingEvent { seq, body: envelope(&source_event_id, &occurred_at, &category, &event_type, &data), source_event_id }),
                // A row this program cannot read back is kept for inspection, never sent or deleted.
                Err(_) => self.quarantine(seq, "conteúdo local ilegível")?,
            }
        }
        Ok(batch)
    }

    /// Removes events the API confirmed. Nothing else ever deletes a row.
    pub fn confirm(&mut self, seqs: &[i64]) -> Result<usize, SpoolError> {
        let tx = self.conn.transaction()?;
        let mut removed = 0;
        for seq in seqs {
            removed += tx.execute("DELETE FROM spool_events WHERE seq = ?1", params![seq])?;
        }
        tx.commit()?;
        Ok(removed)
    }

    pub fn record_failure(&mut self, seqs: &[i64], error: &str) -> Result<(), SpoolError> {
        let tx = self.conn.transaction()?;
        for seq in seqs {
            tx.execute("UPDATE spool_events SET attempts = attempts + 1, last_error = ?2 WHERE seq = ?1", params![seq, error])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Keeps an event the API refused for good (409 conflict, invalid payload)
    /// out of later batches, without deleting it: it stays for inspection.
    pub fn quarantine(&mut self, seq: i64, reason: &str) -> Result<(), SpoolError> {
        self.conn.execute("UPDATE spool_events SET status = 'QUARANTINED', attempts = attempts + 1, last_error = ?2 WHERE seq = ?1", params![seq, reason])?;
        Ok(())
    }

    pub fn stats(&self) -> Result<SpoolStats, SpoolError> {
        let (pending, quarantined, bytes) = self.conn.query_row(
            "SELECT COALESCE(SUM(status = 'PENDING'), 0), COALESCE(SUM(status = 'QUARANTINED'), 0),
                    COALESCE(SUM(LENGTH(data) + LENGTH(occurred_at) + LENGTH(event_type) + ?1), 0) FROM spool_events",
            params![ROW_OVERHEAD_BYTES],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let dropped = self.state(STATE_DROPPED)?.and_then(|v| v.parse().ok()).unwrap_or(0);
        Ok(SpoolStats { pending, quarantined, bytes, dropped })
    }

    pub fn state(&self, key: &str) -> Result<Option<String>, SpoolError> {
        Ok(self.conn.query_row("SELECT value FROM collector_state WHERE key = ?1", params![key], |row| row.get(0)).optional()?)
    }

    pub fn set_state(&self, key: &str, value: &str) -> Result<(), SpoolError> {
        self.conn
            .execute("INSERT INTO collector_state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{ServiceState, SystemEventKind};
    use std::os::unix::fs::MetadataExt;
    use uuid::Uuid;

    fn service_event(name: &str) -> SystemEvent {
        SystemEvent {
            source_event_id: Uuid::new_v4(),
            occurred_at: "2026-11-15T10:00:00.000Z".into(),
            kind: SystemEventKind::ServiceStateChanged { service_name: name.into(), state: ServiceState::Running },
        }
    }

    fn boot(id: &str) -> BootInfo {
        BootInfo { boot_id: Uuid::parse_str(id).unwrap(), boot_time: Some(1_794_765_139) }
    }

    const NOW: &str = "2026-11-15T10:00:01.000Z";

    #[test]
    fn creates_private_files_and_keeps_the_payload_exact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts/h/spool.sqlite3");
        let mut spool = Spool::open(&path, DEFAULT_LIMITS).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().mode() & 0o777, 0o700);

        let event = service_event("sshd.service");
        assert_eq!(spool.enqueue(&event, NOW).unwrap(), EnqueueOutcome::Queued);
        let batch = spool.next_batch(100).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].source_event_id, event.source_event_id.to_string());
        assert_eq!(batch[0].body, envelope(&event.source_event_id.to_string(), &event.occurred_at, "SYSTEM", "SYSTEM_SERVICE_STATE_CHANGED", &event.data()));
    }

    #[test]
    fn survives_reopening_with_the_same_ids_and_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("q").join("spool.sqlite3");
        let events: Vec<SystemEvent> = (0..5).map(|i| service_event(&format!("s{i}.service"))).collect();
        {
            let mut spool = Spool::open(&path, DEFAULT_LIMITS).unwrap();
            for event in &events {
                spool.enqueue(event, NOW).unwrap();
            }
        }
        let mut reopened = Spool::open(&path, DEFAULT_LIMITS).unwrap();
        let ids: Vec<String> = reopened.next_batch(100).unwrap().into_iter().map(|e| e.source_event_id).collect();
        assert_eq!(ids, events.iter().map(|e| e.source_event_id.to_string()).collect::<Vec<_>>());
        // Reading a batch does not remove anything: only a confirmation does.
        assert_eq!(reopened.stats().unwrap().pending, 5);
    }

    #[test]
    fn removes_only_confirmed_events_and_batches_up_to_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), DEFAULT_LIMITS).unwrap();
        for i in 0..150 {
            spool.enqueue(&service_event(&format!("s{i}.service")), NOW).unwrap();
        }
        let first = spool.next_batch(100).unwrap();
        assert_eq!(first.len(), 100);
        spool.record_failure(&first.iter().map(|e| e.seq).collect::<Vec<_>>(), "HTTP 503").unwrap();
        assert_eq!(spool.next_batch(100).unwrap(), first, "a failed batch is retried unchanged");
        assert_eq!(spool.confirm(&first.iter().map(|e| e.seq).collect::<Vec<_>>()).unwrap(), 100);
        assert_eq!(spool.next_batch(100).unwrap().len(), 50);
        assert_eq!(spool.stats().unwrap().pending, 50);
    }

    #[test]
    fn the_same_fact_is_queued_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), DEFAULT_LIMITS).unwrap();
        let event = service_event("a.service");
        assert_eq!(spool.enqueue(&event, NOW).unwrap(), EnqueueOutcome::Queued);
        assert_eq!(spool.enqueue(&event, NOW).unwrap(), EnqueueOutcome::AlreadyQueued);
        assert_eq!(spool.stats().unwrap().pending, 1);
    }

    #[test]
    fn a_boot_is_enqueued_once_across_restarts_and_again_after_a_new_boot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("q").join("spool.sqlite3");
        let first = boot("f9e36ab6-e956-410b-85b5-6abe8bd86f96");
        {
            let mut spool = Spool::open(&path, DEFAULT_LIMITS).unwrap();
            assert_eq!(spool.enqueue_boot_once(&first, &first.to_event(NOW), NOW).unwrap(), BootOutcome::Queued);
            assert_eq!(spool.enqueue_boot_once(&first, &first.to_event(NOW), NOW).unwrap(), BootOutcome::AlreadyReported);
            // Even after the event was delivered and removed, the boot is not reported again.
            let seqs: Vec<i64> = spool.next_batch(10).unwrap().iter().map(|e| e.seq).collect();
            spool.confirm(&seqs).unwrap();
        }
        let mut spool = Spool::open(&path, DEFAULT_LIMITS).unwrap();
        assert_eq!(spool.enqueue_boot_once(&first, &first.to_event(NOW), NOW).unwrap(), BootOutcome::AlreadyReported);
        let second = boot("0b1f8d3e-1111-4222-8333-444455556666");
        assert_eq!(spool.enqueue_boot_once(&second, &second.to_event(NOW), NOW).unwrap(), BootOutcome::Queued);
        assert_eq!(spool.stats().unwrap().pending, 1);
    }

    #[test]
    fn a_full_queue_refuses_new_events_counts_them_and_keeps_the_old_ones() {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), SpoolLimits { max_events: 3, max_bytes: 1_000_000 }).unwrap();
        let kept: Vec<SystemEvent> = (0..3).map(|i| service_event(&format!("s{i}.service"))).collect();
        for event in &kept {
            assert_eq!(spool.enqueue(event, NOW).unwrap(), EnqueueOutcome::Queued);
        }
        assert_eq!(spool.enqueue(&service_event("late.service"), NOW).unwrap(), EnqueueOutcome::Full);
        assert_eq!(spool.enqueue(&service_event("later.service"), NOW).unwrap(), EnqueueOutcome::Full);
        let stats = spool.stats().unwrap();
        assert_eq!((stats.pending, stats.dropped), (3, 2));
        let b = boot("f9e36ab6-e956-410b-85b5-6abe8bd86f96");
        assert_eq!(spool.enqueue_boot_once(&b, &b.to_event(NOW), NOW).unwrap(), BootOutcome::Full);
        // Once there is room again, the boot that could not be stored is tried again.
        let seqs: Vec<i64> = spool.next_batch(1).unwrap().iter().map(|e| e.seq).collect();
        spool.confirm(&seqs).unwrap();
        assert_eq!(spool.enqueue_boot_once(&b, &b.to_event(NOW), NOW).unwrap(), BootOutcome::Queued);
    }

    #[test]
    fn the_size_limit_also_applies() {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), SpoolLimits { max_events: 1000, max_bytes: 600 }).unwrap();
        let mut outcomes = Vec::new();
        for i in 0..5 {
            outcomes.push(spool.enqueue(&service_event(&format!("{i}{}.service", "x".repeat(100))), NOW).unwrap());
        }
        assert!(outcomes.contains(&EnqueueOutcome::Full));
        assert!(spool.stats().unwrap().bytes <= 600);
    }

    #[test]
    fn quarantined_events_leave_the_batches_but_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), DEFAULT_LIMITS).unwrap();
        spool.enqueue(&service_event("a.service"), NOW).unwrap();
        spool.enqueue(&service_event("b.service"), NOW).unwrap();
        let batch = spool.next_batch(10).unwrap();
        spool.quarantine(batch[0].seq, "HTTP 409 EVENT_ID_CONFLICT").unwrap();
        assert_eq!(spool.next_batch(10).unwrap(), vec![batch[1].clone()]);
        let stats = spool.stats().unwrap();
        assert_eq!((stats.pending, stats.quarantined), (1, 1));
    }

    #[test]
    fn refuses_a_queue_reached_through_a_symbolic_link() {
        let dir = tempfile::tempdir().unwrap();
        let private = dir.path().join("q");
        secure_fs::ensure_private_dir(&private).unwrap();
        let real = private.join("real.sqlite3");
        std::fs::write(&real, b"").unwrap();
        let link = private.join("spool.sqlite3");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(matches!(Spool::open(&link, DEFAULT_LIMITS), Err(SpoolError::Fs(SecureFsError::Symlink(_)))));
    }

    /// Child half of `survives_an_abrupt_termination`: enqueue, then abort without running any destructor.
    #[test]
    fn crash_child() {
        let Some(path) = std::env::var_os("AEGIS_SPOOL_CRASH_PATH") else { return };
        let mut spool = Spool::open(Path::new(&path), DEFAULT_LIMITS).unwrap();
        for i in 0..3 {
            spool.enqueue(&service_event(&format!("crash{i}.service")), NOW).unwrap();
        }
        std::process::abort();
    }

    #[test]
    fn survives_an_abrupt_termination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("q").join("spool.sqlite3");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "spool::tests::crash_child", "--nocapture", "--test-threads=1"])
            .env("AEGIS_SPOOL_CRASH_PATH", &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(!status.success(), "the child must have aborted");
        let mut spool = Spool::open(&path, DEFAULT_LIMITS).unwrap();
        assert_eq!(spool.next_batch(10).unwrap().len(), 3);
    }
}

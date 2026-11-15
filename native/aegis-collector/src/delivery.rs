//! What to do with each API answer, and the queue flush built on it.
//!
//! | Answer | Behavior |
//! | --- | --- |
//! | 2xx | the batch was stored (inserted or deduplicated): remove it from the queue |
//! | 401 | the credential is invalid, rotated or revoked: stop transmitting |
//! | 403 | the credential lacks the scope: stop that operation |
//! | 404 | the configured host does not match the credential: stop |
//! | 409 | `sourceEventId` reused with other content: quarantine that event, keep it |
//! | 400 / 413 | invalid or too large: quarantine (or halve the batch), never retry forever |
//! | 429 | wait `Retry-After` (or back off) |
//! | 5xx, network | back off with jitter and retry the same batch |

use std::time::Duration;

use serde_json::Value;

use crate::http::{ApiResponse, MachineTransport, TransportError};
use crate::logger::Logger;
use crate::spool::{PendingEvent, Spool, SpoolError};

/// The API accepts at most 100 events per batch (`EVENT_LIMITS.maxBatch`).
pub const MAX_BATCH: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fatal {
    /// 401: the credential no longer authenticates.
    CredentialRejected,
    /// 403 on ingestion: the credential cannot send events.
    Forbidden,
    /// 404: workspace or host in the configuration do not belong to the credential.
    HostMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestVerdict {
    Accepted,
    Fatal(Fatal),
    /// Indices (within the batch) of events refused for good; empty means "the whole batch".
    Reject {
        indices: Vec<usize>,
        reason: String,
    },
    TooLarge,
    RateLimited(Option<Duration>),
    Retry(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeartbeatVerdict {
    Recorded {
        interval: Duration,
    },
    Fatal(Fatal),
    /// 403: this credential predates `host:heartbeat`; rotating it in the panel grants it.
    NotAllowed,
    RateLimited(Option<Duration>),
    Retry(String),
}

/// `events.<i>.<field>` issues of a 400/409 answer, as batch indices.
fn issue_indices(body: Option<Value>, batch_len: usize) -> Vec<usize> {
    let mut indices: Vec<usize> = body
        .as_ref()
        .and_then(|b| b.pointer("/error/issues"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|issue| issue.get("field")?.as_str()?.strip_prefix("events.")?.split('.').next()?.parse::<usize>().ok())
        .filter(|i| *i < batch_len)
        .collect();
    indices.sort_unstable();
    indices.dedup();
    indices
}

fn error_code(body: Option<Value>) -> String {
    body.as_ref()
        .and_then(|b| b.pointer("/error/code"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_uppercase() || *c == '_')
        .take(40)
        .collect()
}

pub fn classify_ingest(result: Result<ApiResponse, TransportError>, batch_len: usize) -> IngestVerdict {
    let response = match result {
        Ok(response) => response,
        Err(error) => return IngestVerdict::Retry(error.to_string()),
    };
    match response.status {
        200..=299 => {
            let received = response.json().and_then(|b| b.get("received")?.as_u64());
            if received == Some(batch_len as u64) { IngestVerdict::Accepted } else { IngestVerdict::Retry("resposta de ingestão inesperada".into()) }
        }
        401 => IngestVerdict::Fatal(Fatal::CredentialRejected),
        403 => IngestVerdict::Fatal(Fatal::Forbidden),
        404 => IngestVerdict::Fatal(Fatal::HostMismatch),
        409 => IngestVerdict::Reject { indices: issue_indices(response.json(), batch_len), reason: format!("HTTP 409 {}", error_code(response.json())) },
        400 | 422 => IngestVerdict::Reject { indices: issue_indices(response.json(), batch_len), reason: format!("HTTP 400 {}", error_code(response.json())) },
        413 => IngestVerdict::TooLarge,
        429 => IngestVerdict::RateLimited(response.retry_after),
        status => IngestVerdict::Retry(format!("HTTP {status}")),
    }
}

pub const MIN_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
pub const MAX_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(300);
pub const DEFAULT_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub fn classify_heartbeat(result: Result<ApiResponse, TransportError>) -> HeartbeatVerdict {
    let response = match result {
        Ok(response) => response,
        Err(error) => return HeartbeatVerdict::Retry(error.to_string()),
    };
    match response.status {
        200..=299 => {
            let seconds = response.json().and_then(|b| b.get("heartbeatIntervalSeconds")?.as_u64());
            let interval = seconds.map(Duration::from_secs).unwrap_or(DEFAULT_HEARTBEAT_INTERVAL).clamp(MIN_HEARTBEAT_INTERVAL, MAX_HEARTBEAT_INTERVAL);
            HeartbeatVerdict::Recorded { interval }
        }
        401 => HeartbeatVerdict::Fatal(Fatal::CredentialRejected),
        403 => HeartbeatVerdict::NotAllowed,
        404 => HeartbeatVerdict::Fatal(Fatal::HostMismatch),
        429 => HeartbeatVerdict::RateLimited(response.retry_after),
        status => HeartbeatVerdict::Retry(format!("HTTP {status}")),
    }
}

/// Exponential backoff with full jitter: a random delay in `[min, min(max, base · 2^n)]`.
#[derive(Debug, Clone)]
pub struct Backoff {
    base: Duration,
    max: Duration,
    attempt: u32,
}

impl Backoff {
    pub fn new(base: Duration, max: Duration) -> Self {
        Self { base, max, attempt: 0 }
    }

    pub fn ceiling(&self) -> Duration {
        self.base.saturating_mul(1u32 << self.attempt.min(16)).min(self.max)
    }

    /// The next delay, given a random value (tests pass fixed ones).
    pub fn next_with(&mut self, random: u64) -> Duration {
        let ceiling = self.ceiling();
        self.attempt = self.attempt.saturating_add(1);
        let min = Duration::from_secs(1).min(ceiling);
        let span = ceiling.saturating_sub(min).as_millis() as u64;
        min + Duration::from_millis(if span == 0 { 0 } else { random % (span + 1) })
    }

    pub fn next_delay(&mut self) -> Duration {
        let mut bytes = [0u8; 8];
        // Without OS randomness the delay is just the ceiling: still bounded, only less spread.
        let random = getrandom::fill(&mut bytes).map(|_| u64::from_le_bytes(bytes)).unwrap_or(u64::MAX);
        self.next_with(random)
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn attempts(&self) -> u32 {
        self.attempt
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new(Duration::from_secs(2), Duration::from_secs(300))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FlushOutcome {
    /// Nothing pending.
    Idle,
    /// Everything that was pending was delivered (or quarantined).
    Drained { delivered: usize },
    /// Some events remain; call again (after `delay`, possibly zero).
    Later { delivered: usize, delay: Duration },
    /// Transmission must stop; queued events stay for a future credential.
    Stop(Fatal),
}

/// Delivers queued events in batches of at most `MAX_BATCH`, removing only
/// what the API confirmed. Stops at the first answer that needs waiting.
pub struct Deliverer {
    pub backoff: Backoff,
    batch_size: usize,
    /// Upper bound of batches per call, so one flush never starves the rest of the loop.
    pub max_batches_per_flush: usize,
}

impl Default for Deliverer {
    fn default() -> Self {
        Self { backoff: Backoff::default(), batch_size: MAX_BATCH, max_batches_per_flush: 20 }
    }
}

impl Deliverer {
    pub fn batch_size(&self) -> usize {
        self.batch_size
    }

    pub fn flush(&mut self, spool: &mut Spool, api: &dyn MachineTransport, log: &Logger) -> Result<FlushOutcome, SpoolError> {
        let mut delivered = 0;
        for _ in 0..self.max_batches_per_flush {
            let batch: Vec<PendingEvent> = spool.next_batch(self.batch_size)?;
            if batch.is_empty() {
                return Ok(if delivered == 0 { FlushOutcome::Idle } else { FlushOutcome::Drained { delivered } });
            }
            let seqs: Vec<i64> = batch.iter().map(|e| e.seq).collect();
            let bodies: Vec<Value> = batch.iter().map(|e| e.body.clone()).collect();
            match classify_ingest(api.ingest(&bodies), batch.len()) {
                IngestVerdict::Accepted => {
                    spool.confirm(&seqs)?;
                    delivered += batch.len();
                    self.backoff.reset();
                    self.batch_size = MAX_BATCH;
                }
                IngestVerdict::Fatal(fatal) => {
                    spool.record_failure(&seqs, &format!("{fatal:?}"))?;
                    return Ok(FlushOutcome::Stop(fatal));
                }
                IngestVerdict::Reject { indices, reason } => {
                    let targets: Vec<&PendingEvent> =
                        if indices.is_empty() { batch.iter().collect() } else { indices.iter().filter_map(|i| batch.get(*i)).collect() };
                    for event in &targets {
                        spool.quarantine(event.seq, &reason)?;
                    }
                    log.error(&format!(
                        "{} evento(s) recusado(s) pela API ({reason}); mantidos na fila em quarentena, fora dos próximos envios. Ids: {}",
                        targets.len(),
                        targets.iter().map(|e| e.source_event_id.as_str()).collect::<Vec<_>>().join(", ")
                    ));
                }
                IngestVerdict::TooLarge => {
                    if batch.len() == 1 {
                        spool.quarantine(seqs[0], "HTTP 413 evento grande demais")?;
                        log.error(&format!("evento {} grande demais para a API; mantido em quarentena", batch[0].source_event_id));
                    } else {
                        self.batch_size = (batch.len() / 2).max(1);
                        log.warn(&format!("lote grande demais; reduzindo para {} eventos", self.batch_size));
                    }
                }
                IngestVerdict::RateLimited(retry_after) => {
                    spool.record_failure(&seqs, "HTTP 429")?;
                    let delay = retry_after.unwrap_or_else(|| self.backoff.next_delay());
                    log.warn(&format!("API pediu para aguardar; nova tentativa em {}s", delay.as_secs()));
                    return Ok(FlushOutcome::Later { delivered, delay });
                }
                IngestVerdict::Retry(reason) => {
                    spool.record_failure(&seqs, &reason)?;
                    let delay = self.backoff.next_delay();
                    log.warn(&format!("envio de {} evento(s) falhou ({reason}); eventos preservados, nova tentativa em {}s", batch.len(), delay.as_secs()));
                    return Ok(FlushOutcome::Later { delivered, delay });
                }
            }
        }
        Ok(FlushOutcome::Later { delivered, delay: Duration::ZERO })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{ServiceState, SystemEvent, SystemEventKind};
    use crate::logger::CapturedLog;
    use crate::spool::DEFAULT_LIMITS;
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use uuid::Uuid;

    fn response(status: u16, body: Value) -> Result<ApiResponse, TransportError> {
        Ok(ApiResponse { status, retry_after: None, body: body.to_string().into_bytes() })
    }

    #[test]
    fn maps_every_documented_answer() {
        assert_eq!(classify_ingest(response(200, json!({ "received": 3, "inserted": 2, "deduplicated": 1 })), 3), IngestVerdict::Accepted);
        assert!(matches!(classify_ingest(response(200, json!({ "received": 2 })), 3), IngestVerdict::Retry(_)));
        assert_eq!(classify_ingest(response(401, json!({})), 3), IngestVerdict::Fatal(Fatal::CredentialRejected));
        assert_eq!(classify_ingest(response(403, json!({})), 3), IngestVerdict::Fatal(Fatal::Forbidden));
        assert_eq!(classify_ingest(response(404, json!({})), 3), IngestVerdict::Fatal(Fatal::HostMismatch));
        assert_eq!(
            classify_ingest(response(409, json!({ "error": { "code": "EVENT_ID_CONFLICT", "issues": [{ "field": "events.1.sourceEventId" }] } })), 3),
            IngestVerdict::Reject { indices: vec![1], reason: "HTTP 409 EVENT_ID_CONFLICT".into() }
        );
        assert_eq!(
            classify_ingest(
                response(
                    400,
                    json!({ "error": { "code": "VALIDATION_ERROR", "issues": [{ "field": "events.2.data.system.state" }, { "field": "events.2.occurredAt" }, { "field": "events.9.x" }] } })
                ),
                3
            ),
            IngestVerdict::Reject { indices: vec![2], reason: "HTTP 400 VALIDATION_ERROR".into() }
        );
        assert_eq!(classify_ingest(response(413, json!({})), 3), IngestVerdict::TooLarge);
        assert_eq!(
            classify_ingest(Ok(ApiResponse { status: 429, retry_after: Some(Duration::from_secs(42)), body: vec![] }), 3),
            IngestVerdict::RateLimited(Some(Duration::from_secs(42)))
        );
        assert_eq!(classify_ingest(response(503, json!({})), 3), IngestVerdict::Retry("HTTP 503".into()));
        assert!(matches!(classify_ingest(Err(TransportError::Connect), 3), IngestVerdict::Retry(_)));
    }

    #[test]
    fn heartbeat_answers() {
        assert_eq!(
            classify_heartbeat(response(200, json!({ "heartbeatIntervalSeconds": 30 }))),
            HeartbeatVerdict::Recorded { interval: Duration::from_secs(30) }
        );
        assert_eq!(
            classify_heartbeat(response(200, json!({ "heartbeatIntervalSeconds": 1 }))),
            HeartbeatVerdict::Recorded { interval: MIN_HEARTBEAT_INTERVAL }
        );
        assert_eq!(classify_heartbeat(response(200, json!({}))), HeartbeatVerdict::Recorded { interval: DEFAULT_HEARTBEAT_INTERVAL });
        assert_eq!(classify_heartbeat(response(401, json!({}))), HeartbeatVerdict::Fatal(Fatal::CredentialRejected));
        assert_eq!(classify_heartbeat(response(403, json!({}))), HeartbeatVerdict::NotAllowed);
        assert_eq!(classify_heartbeat(response(404, json!({}))), HeartbeatVerdict::Fatal(Fatal::HostMismatch));
        assert!(matches!(classify_heartbeat(Err(TransportError::Timeout)), HeartbeatVerdict::Retry(_)));
    }

    #[test]
    fn backoff_grows_exponentially_with_jitter_and_a_ceiling() {
        let mut backoff = Backoff::new(Duration::from_secs(2), Duration::from_secs(60));
        let ceilings: Vec<u64> = (0..8)
            .map(|_| {
                let c = backoff.ceiling().as_secs();
                backoff.next_with(0);
                c
            })
            .collect();
        assert_eq!(ceilings, [2, 4, 8, 16, 32, 60, 60, 60]);
        let mut jittered = Backoff::new(Duration::from_secs(2), Duration::from_secs(60));
        for _ in 0..5 {
            jittered.next_with(0);
        }
        assert_eq!(jittered.next_with(0), Duration::from_secs(1));
        assert!(jittered.next_with(u64::MAX - 1).as_secs() <= 60);
        let mut random = Backoff::default();
        for _ in 0..50 {
            let delay = random.next_delay();
            assert!(delay >= Duration::from_secs(1) && delay <= Duration::from_secs(300));
        }
        random.reset();
        assert_eq!(random.attempts(), 0);
    }

    /// Scripted API: answers in order and records every batch it received.
    struct Scripted {
        answers: RefCell<VecDeque<Result<ApiResponse, TransportError>>>,
        batches: RefCell<Vec<Vec<Value>>>,
    }

    impl Scripted {
        fn new(answers: Vec<Result<ApiResponse, TransportError>>) -> Self {
            Self { answers: RefCell::new(answers.into()), batches: RefCell::default() }
        }
    }

    impl MachineTransport for Scripted {
        fn heartbeat(&self) -> Result<ApiResponse, TransportError> {
            response(200, json!({ "heartbeatIntervalSeconds": 30 }))
        }
        fn ingest(&self, events: &[Value]) -> Result<ApiResponse, TransportError> {
            self.batches.borrow_mut().push(events.to_vec());
            self.answers.borrow_mut().pop_front().unwrap_or_else(|| response(200, json!({ "received": events.len() })))
        }
    }

    fn filled(count: usize) -> (tempfile::TempDir, Spool) {
        let dir = tempfile::tempdir().unwrap();
        let mut spool = Spool::open(&dir.path().join("q").join("spool.sqlite3"), DEFAULT_LIMITS).unwrap();
        for i in 0..count {
            let event = SystemEvent {
                source_event_id: Uuid::new_v4(),
                occurred_at: "2026-11-15T10:00:00.000Z".into(),
                kind: SystemEventKind::ServiceStateChanged { service_name: format!("s{i}.service"), state: ServiceState::Running },
            };
            spool.enqueue(&event, "2026-11-15T10:00:01.000Z").unwrap();
        }
        (dir, spool)
    }

    #[test]
    fn sends_batches_of_at_most_100_and_removes_only_confirmed_ones() {
        let (_dir, mut spool) = filled(250);
        let api = Scripted::new(vec![]);
        let outcome = Deliverer::default().flush(&mut spool, &api, &CapturedLog::default().logger()).unwrap();
        assert_eq!(outcome, FlushOutcome::Drained { delivered: 250 });
        let sizes: Vec<usize> = api.batches.borrow().iter().map(Vec::len).collect();
        assert_eq!(sizes, [100, 100, 50]);
        assert_eq!(spool.stats().unwrap().pending, 0);
    }

    #[test]
    fn a_failed_batch_stays_and_is_resent_with_the_same_ids() {
        let (_dir, mut spool) = filled(3);
        let api = Scripted::new(vec![response(503, json!({})), Err(TransportError::Timeout)]);
        let log = CapturedLog::default();
        let mut deliverer = Deliverer::default();
        assert!(matches!(deliverer.flush(&mut spool, &api, &log.logger()).unwrap(), FlushOutcome::Later { delivered: 0, .. }));
        assert!(matches!(deliverer.flush(&mut spool, &api, &log.logger()).unwrap(), FlushOutcome::Later { delivered: 0, .. }));
        assert_eq!(spool.stats().unwrap().pending, 3);
        assert_eq!(deliverer.backoff.attempts(), 2);
        assert_eq!(deliverer.flush(&mut spool, &api, &log.logger()).unwrap(), FlushOutcome::Drained { delivered: 3 });
        let batches = api.batches.borrow();
        assert_eq!(batches[0], batches[2], "identical retries: same ids and content");
        assert_eq!(deliverer.backoff.attempts(), 0);
    }

    #[test]
    fn a_401_stops_without_losing_anything_and_without_retrying() {
        let (_dir, mut spool) = filled(3);
        let api = Scripted::new(vec![response(401, json!({}))]);
        let outcome = Deliverer::default().flush(&mut spool, &api, &CapturedLog::default().logger()).unwrap();
        assert_eq!(outcome, FlushOutcome::Stop(Fatal::CredentialRejected));
        assert_eq!(api.batches.borrow().len(), 1);
        assert_eq!(spool.stats().unwrap().pending, 3);
    }

    #[test]
    fn a_409_quarantines_only_the_conflicting_event() {
        let (_dir, mut spool) = filled(3);
        let api = Scripted::new(vec![response(409, json!({ "error": { "code": "EVENT_ID_CONFLICT", "issues": [{ "field": "events.1.sourceEventId" }] } }))]);
        let log = CapturedLog::default();
        let outcome = Deliverer::default().flush(&mut spool, &api, &log.logger()).unwrap();
        assert_eq!(outcome, FlushOutcome::Drained { delivered: 2 });
        let stats = spool.stats().unwrap();
        assert_eq!((stats.pending, stats.quarantined), (0, 1));
        let batches = api.batches.borrow();
        assert_eq!(batches[1].len(), 2);
        assert!(!batches[1].contains(&batches[0][1]));
        assert!(log.text().contains("409"));
    }

    #[test]
    fn an_invalid_payload_is_not_retried_forever() {
        let (_dir, mut spool) = filled(2);
        let api = Scripted::new(vec![response(400, json!({ "error": { "code": "VALIDATION_ERROR" } }))]);
        let outcome = Deliverer::default().flush(&mut spool, &api, &CapturedLog::default().logger()).unwrap();
        assert_eq!(outcome, FlushOutcome::Idle);
        assert_eq!(spool.stats().unwrap().quarantined, 2);
        assert_eq!(api.batches.borrow().len(), 1);
    }

    #[test]
    fn a_429_waits_for_retry_after() {
        let (_dir, mut spool) = filled(2);
        let api = Scripted::new(vec![Ok(ApiResponse { status: 429, retry_after: Some(Duration::from_secs(17)), body: vec![] })]);
        let outcome = Deliverer::default().flush(&mut spool, &api, &CapturedLog::default().logger()).unwrap();
        assert_eq!(outcome, FlushOutcome::Later { delivered: 0, delay: Duration::from_secs(17) });
        assert_eq!(spool.stats().unwrap().pending, 2);
    }

    #[test]
    fn a_413_halves_the_batch() {
        let (_dir, mut spool) = filled(8);
        let api = Scripted::new(vec![response(413, json!({}))]);
        let mut deliverer = Deliverer::default();
        assert_eq!(deliverer.flush(&mut spool, &api, &CapturedLog::default().logger()).unwrap(), FlushOutcome::Drained { delivered: 8 });
        let sizes: Vec<usize> = api.batches.borrow().iter().map(Vec::len).collect();
        assert_eq!(sizes, [8, 4, 4]);
    }
}

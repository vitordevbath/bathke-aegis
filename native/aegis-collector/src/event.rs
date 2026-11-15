//! SYSTEM events in the shape of the Aegis Event Contract v1
//! (`packages/domain/src/event-contract.ts`, `docs/EVENTOS.md`). Only the two
//! SYSTEM types exist here; fields the contract forbids for a type are omitted,
//! and nothing beyond the contract is ever added.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 1;
pub const SERVICE_NAME_MAX: usize = 256;

/// Portable service states of the contract (`SERVICE_STATES`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

impl ServiceState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "STARTING",
            Self::Running => "RUNNING",
            Self::Stopping => "STOPPING",
            Self::Stopped => "STOPPED",
            Self::Failed => "FAILED",
        }
    }
}

/// One fact to report, as kept in the queue: the id is fixed when the fact is
/// observed and never changes across retries, so the API can deduplicate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemEvent {
    pub source_event_id: Uuid,
    pub occurred_at: String,
    pub kind: SystemEventKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SystemEventKind {
    Boot,
    ServiceStateChanged { service_name: String, state: ServiceState },
}

impl SystemEvent {
    pub fn category(&self) -> &'static str {
        "SYSTEM"
    }

    pub fn event_type(&self) -> &'static str {
        match self.kind {
            SystemEventKind::Boot => "SYSTEM_BOOT",
            SystemEventKind::ServiceStateChanged { .. } => "SYSTEM_SERVICE_STATE_CHANGED",
        }
    }

    /// The `data` member of the contract envelope.
    pub fn data(&self) -> Value {
        match &self.kind {
            SystemEventKind::Boot => json!({ "system": { "eventType": "BOOT" } }),
            SystemEventKind::ServiceStateChanged { service_name, state } => {
                json!({ "system": { "eventType": "SERVICE_STATE_CHANGED", "serviceName": service_name, "state": state.as_str() } })
            }
        }
    }
}

/// The full envelope sent to `POST …/events/ingest`.
pub fn envelope(source_event_id: &str, occurred_at: &str, category: &str, event_type: &str, data: &Value) -> Value {
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "sourceEventId": source_event_id,
        "occurredAt": occurred_at,
        "category": category,
        "type": event_type,
        "data": data,
    })
}

/// The contract's text rule: non-empty, bounded, no control characters.
pub fn is_valid_service_name(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= SERVICE_NAME_MAX && !name.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_has_exactly_the_contract_fields() {
        let event = SystemEvent { source_event_id: Uuid::nil(), occurred_at: "2026-11-15T10:00:00.000Z".into(), kind: SystemEventKind::Boot };
        let body = envelope(&event.source_event_id.to_string(), &event.occurred_at, event.category(), event.event_type(), &event.data());
        assert_eq!(
            body,
            json!({
                "schemaVersion": 1,
                "sourceEventId": "00000000-0000-0000-0000-000000000000",
                "occurredAt": "2026-11-15T10:00:00.000Z",
                "category": "SYSTEM",
                "type": "SYSTEM_BOOT",
                "data": { "system": { "eventType": "BOOT" } }
            })
        );
    }

    #[test]
    fn service_change_carries_name_and_portable_state_only() {
        let event = SystemEvent {
            source_event_id: Uuid::nil(),
            occurred_at: "2026-11-15T10:00:00.000Z".into(),
            kind: SystemEventKind::ServiceStateChanged { service_name: "sshd.service".into(), state: ServiceState::Failed },
        };
        assert_eq!(event.event_type(), "SYSTEM_SERVICE_STATE_CHANGED");
        assert_eq!(event.data(), json!({ "system": { "eventType": "SERVICE_STATE_CHANGED", "serviceName": "sshd.service", "state": "FAILED" } }));
    }

    #[test]
    fn service_names_follow_the_contract_text_rule() {
        assert!(is_valid_service_name("systemd-cryptsetup@luks\\x2d1.service"));
        assert!(!is_valid_service_name(""));
        assert!(!is_valid_service_name("a\u{7}b.service"));
        assert!(!is_valid_service_name(&"a".repeat(257)));
    }
}

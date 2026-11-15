//! Service state tracking over snapshots of `systemctl list-units`. The first
//! snapshot is the baseline and produces no events; afterwards only real
//! changes do. A unit that leaves the list (unloaded or removed) is treated as
//! STOPPED, which is what "not loaded" means for a service; a failed query
//! changes nothing.

use std::collections::BTreeMap;

use crate::event::{ServiceState, is_valid_service_name};

/// Maps systemd's `ActiveState` to the contract's portable states.
pub fn state_of(active: &str) -> Option<ServiceState> {
    Some(match active {
        "active" | "reloading" | "refreshing" => ServiceState::Running,
        "activating" => ServiceState::Starting,
        "deactivating" => ServiceState::Stopping,
        "inactive" | "maintenance" => ServiceState::Stopped,
        "failed" => ServiceState::Failed,
        _ => return None,
    })
}

/// Parses `systemctl list-units --type=service --all --plain --no-legend`:
/// `UNIT LOAD ACTIVE SUB DESCRIPTION…`. Only the unit name and its active
/// state are kept; descriptions are not collected. Unknown lines are skipped.
pub fn parse_list_units(output: &str) -> BTreeMap<String, ServiceState> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let unit = fields.next()?;
            let _load = fields.next()?;
            let state = state_of(fields.next()?)?;
            (unit.ends_with(".service") && is_valid_service_name(unit)).then(|| (unit.to_string(), state))
        })
        .collect()
}

#[derive(Debug, Default)]
pub struct ServiceTracker {
    baseline: Option<BTreeMap<String, ServiceState>>,
}

impl ServiceTracker {
    pub fn has_baseline(&self) -> bool {
        self.baseline.is_some()
    }

    pub fn tracked(&self) -> usize {
        self.baseline.as_ref().map_or(0, BTreeMap::len)
    }

    /// Feeds a successful snapshot; returns the changes since the previous one, in name order.
    pub fn observe(&mut self, current: BTreeMap<String, ServiceState>) -> Vec<(String, ServiceState)> {
        let Some(previous) = self.baseline.replace(current) else { return Vec::new() };
        let current = self.baseline.as_ref().expect("just set");
        let mut changes: Vec<(String, ServiceState)> = current
            .iter()
            .filter(|(unit, state)| previous.get(*unit).copied().unwrap_or(ServiceState::Stopped) != **state)
            .map(|(unit, state)| (unit.clone(), *state))
            .collect();
        changes.extend(
            previous
                .iter()
                .filter(|(unit, state)| !current.contains_key(*unit) && **state != ServiceState::Stopped)
                .map(|(unit, _)| (unit.clone(), ServiceState::Stopped)),
        );
        changes.sort_by(|a, b| a.0.cmp(&b.0));
        changes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAPSHOT: &str = "\
abrtd.service                 loaded    active   running ABRT Daemon
alsa-restore.service          loaded    inactive dead    Save/Restore Sound Card State
sshd.service                  loaded    active   running OpenSSH server daemon
dnf-makecache.service         loaded    activating start Update metadata
nfs-server.service            not-found inactive dead   nfs-server.service
broken.service                loaded    failed   failed  Broken thing
weird.service                 loaded    unknownstate x   Something
session-2.scope               loaded    active   running Session 2
";

    fn snapshot(text: &str) -> BTreeMap<String, ServiceState> {
        parse_list_units(text)
    }

    #[test]
    fn parses_units_and_maps_states() {
        let parsed = snapshot(SNAPSHOT);
        assert_eq!(parsed.get("abrtd.service"), Some(&ServiceState::Running));
        assert_eq!(parsed.get("alsa-restore.service"), Some(&ServiceState::Stopped));
        assert_eq!(parsed.get("dnf-makecache.service"), Some(&ServiceState::Starting));
        assert_eq!(parsed.get("broken.service"), Some(&ServiceState::Failed));
        assert_eq!(parsed.get("nfs-server.service"), Some(&ServiceState::Stopped));
        assert!(!parsed.contains_key("weird.service"));
        assert!(!parsed.contains_key("session-2.scope"));
        assert_eq!(parsed.len(), 6);
        assert_eq!(state_of("deactivating"), Some(ServiceState::Stopping));
    }

    #[test]
    fn the_first_snapshot_is_a_silent_baseline() {
        let mut tracker = ServiceTracker::default();
        assert!(tracker.observe(snapshot(SNAPSHOT)).is_empty());
        assert!(tracker.has_baseline());
        // Same state again: nothing to report, on every cycle.
        assert!(tracker.observe(snapshot(SNAPSHOT)).is_empty());
        assert!(tracker.observe(snapshot(SNAPSHOT)).is_empty());
    }

    #[test]
    fn reports_only_real_transitions() {
        let mut tracker = ServiceTracker::default();
        tracker.observe(snapshot(SNAPSHOT));
        let next = SNAPSHOT
            .replace("sshd.service                  loaded    active   running", "sshd.service                  loaded    failed   failed ")
            .replace("dnf-makecache.service         loaded    activating start", "dnf-makecache.service         loaded    active     running");
        assert_eq!(
            tracker.observe(snapshot(&next)),
            vec![("dnf-makecache.service".to_string(), ServiceState::Running), ("sshd.service".to_string(), ServiceState::Failed)]
        );
        assert!(tracker.observe(snapshot(&next)).is_empty());
    }

    #[test]
    fn removed_and_new_units() {
        let mut tracker = ServiceTracker::default();
        tracker.observe(snapshot(SNAPSHOT));
        // abrtd (running) and alsa-restore (stopped) disappear; a transient service appears running.
        let next = SNAPSHOT
            .lines()
            .filter(|line| !line.starts_with("abrtd") && !line.starts_with("alsa-restore"))
            .chain(std::iter::once("run-u42.service loaded active running transient"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            tracker.observe(snapshot(&next)),
            vec![("abrtd.service".to_string(), ServiceState::Stopped), ("run-u42.service".to_string(), ServiceState::Running)]
        );
        // A new unit that appears already stopped is not a change.
        let with_stopped = format!("{next}\nnew-idle.service loaded inactive dead idle");
        assert!(tracker.observe(snapshot(&with_stopped)).is_empty());
    }
}

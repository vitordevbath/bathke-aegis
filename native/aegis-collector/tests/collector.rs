//! End-to-end behavior of the Collector library against a local HTTP server:
//! pairing, the run loop, heartbeat, SYSTEM events, the queue and every
//! documented API answer. No real Aegis, systemd unit or /proc entry is needed.

mod support;

use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use aegis_collector::commands;
use aegis_collector::config::{CollectorConfig, Secret};
use aegis_collector::delivery::Fatal;
use aegis_collector::logger::CapturedLog;
use aegis_collector::paths::Paths;
use aegis_collector::run::{RunExit, RunOptions, SystemdSource, run};
use aegis_collector::spool::{DEFAULT_LIMITS, Spool};
use serde_json::{Value, json};
use support::{MockServer, Reply, closed_port_url};

const WORKSPACE: &str = "0b6c2f1e-0000-4000-8000-0000000000aa";
const HOST: &str = "0b6c2f1e-0000-4000-8000-0000000000bb";
const CREDENTIAL: &str = "1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab";
const BOOT_ID: &str = "f9e36ab6-e956-410b-85b5-6abe8bd86f96";

/// Assembled at runtime; shaped like real secrets but never real ones.
fn code() -> String {
    format!("aegis_pair_{}", "K".repeat(20) + "-_" + &"m".repeat(21))
}
fn token() -> String {
    format!("aegis_agent_{}.{}", CREDENTIAL.replace('-', ""), "T".repeat(21) + "_-" + &"s".repeat(20))
}
fn rotated_credential() -> &'static str {
    "2b3c4d5e-6f70-4b1c-9d2e-123456789abc"
}
fn rotated_token() -> String {
    format!("aegis_agent_{}.{}", rotated_credential().replace('-', ""), "R".repeat(43))
}

struct Env {
    root: tempfile::TempDir,
    paths: Paths,
    proc_root: PathBuf,
}

fn env() -> Env {
    let root = tempfile::tempdir().unwrap();
    let paths = Paths::under(&root.path().join("config"), &root.path().join("state"));
    let proc_root = root.path().join("proc");
    fs::create_dir_all(proc_root.join("sys/kernel/random")).unwrap();
    fs::write(proc_root.join("sys/kernel/random/boot_id"), format!("{BOOT_ID}\n")).unwrap();
    fs::write(proc_root.join("stat"), "cpu 1 2 3\nbtime 1794765139\nprocesses 10\n").unwrap();
    Env { root, paths, proc_root }
}

fn paired_config(server: &str) -> CollectorConfig {
    CollectorConfig {
        version: 1,
        server: server.into(),
        workspace_id: WORKSPACE.into(),
        host_id: HOST.into(),
        credential_id: CREDENTIAL.into(),
        scopes: vec!["events:ingest".into(), "host:heartbeat".into()],
        paired_at: "2026-11-15T10:00:00.000Z".into(),
        token: Secret::new(token()),
    }
}

/// A stand-in for systemctl: prints whatever the fixture file holds.
fn fake_systemctl(env: &Env, units: &str) -> (PathBuf, PathBuf) {
    let fixture = env.root.path().join("units.txt");
    fs::write(&fixture, units).unwrap();
    let script = env.root.path().join("systemctl");
    fs::write(&script, format!("#!/bin/sh\nexec /usr/bin/cat '{}'\n", fixture.display())).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    (script, fixture)
}

fn options(env: &Env, systemd: SystemdSource, once: bool) -> RunOptions {
    RunOptions {
        proc_root: env.proc_root.clone(),
        systemd,
        once,
        service_poll_interval: Duration::from_millis(150),
        flush_interval: Duration::from_millis(100),
        spool_limits: DEFAULT_LIMITS,
    }
}

/// A well-behaved Aegis API for one host: accepts heartbeats and every batch.
fn healthy_api() -> MockServer {
    MockServer::start(|request| {
        if request.path.ends_with("/heartbeat") {
            Reply::json(200, json!({ "lastSeenAt": "2026-11-15T10:00:00.000Z", "heartbeatIntervalSeconds": 30 }))
        } else if request.path.ends_with("/events/ingest") {
            let count = request.json()["events"].as_array().map_or(0, Vec::len);
            Reply::json(200, json!({ "received": count, "inserted": count, "deduplicated": 0 }))
        } else {
            Reply::json(404, json!({}))
        }
    })
}

fn pending(env: &Env) -> i64 {
    Spool::open(&env.paths.spool_file(HOST), DEFAULT_LIMITS).unwrap().stats().unwrap().pending
}

fn assert_no_secret(text: &str) {
    assert!(!text.contains(&token()), "credential leaked");
    assert!(!text.contains(&token()[token().len() - 43..]), "credential secret leaked");
    assert!(!text.contains(&code()), "pairing code leaked");
    assert!(!text.contains(&rotated_token()), "rotated credential leaked");
}

// ── pairing ──────────────────────────────────────────────────────────────────

#[test]
fn pairs_with_a_code_and_stores_the_credential_privately() {
    let env = env();
    let server = MockServer::start(|request| {
        assert_eq!(request.path, "/api/agent/pair");
        Reply::json(
            201,
            json!({ "token": token(), "tokenType": "Bearer", "credentialId": CREDENTIAL, "workspaceId": WORKSPACE, "hostId": HOST, "scopes": ["events:ingest", "host:heartbeat"] }),
        )
    });
    let config = commands::pair(&env.paths, &server.url, &Secret::new(code())).unwrap();
    assert_eq!((config.workspace_id.as_str(), config.host_id.as_str()), (WORKSPACE, HOST));

    // Only the code is sent: the server decides workspace and host.
    let [request] = server.requests().try_into().unwrap();
    assert_eq!(request.json(), json!({ "code": code() }));
    assert!(request.header("authorization").is_none());

    let file = env.paths.config_file();
    assert_eq!(fs::metadata(&file).unwrap().mode() & 0o777, 0o600);
    assert_eq!(fs::metadata(&env.paths.config_dir).unwrap().mode() & 0o777, 0o700);
    assert_eq!(CollectorConfig::load(&env.paths).unwrap().unwrap().token.expose(), token());

    let report = commands::status(&env.paths).unwrap();
    assert!(report.contains("aegis_agent_1a2b3c4d"));
    assert_no_secret(&report);

    // An existing pairing is never overwritten.
    let again = commands::pair(&env.paths, &server.url, &Secret::new(code())).unwrap_err().to_string();
    assert!(again.contains("unpair"), "{again}");
    assert_eq!(server.requests().len(), 1);
}

#[test]
fn a_refused_or_malformed_code_stores_nothing_and_is_never_echoed() {
    let env = env();
    let server = MockServer::start(|_| Reply::json(401, json!({ "error": { "code": "AUTHENTICATION_ERROR" } })));
    let refused = commands::pair(&env.paths, &server.url, &Secret::new(code())).unwrap_err().to_string();
    assert!(refused.contains("Gere um novo código"), "{refused}");
    assert!(!CollectorConfig::exists(&env.paths));
    assert_no_secret(&refused);

    let malformed = commands::pair(&env.paths, &server.url, &Secret::new("aegis_pair_curto".into())).unwrap_err().to_string();
    assert!(!malformed.contains("curto"));
    assert_eq!(server.requests().len(), 1, "a malformed code is not sent");

    let limited = MockServer::start(|_| Reply::json(429, json!({})).with_header("Retry-After", "42"));
    assert!(commands::pair(&env.paths, &limited.url, &Secret::new(code())).unwrap_err().to_string().contains("42s"));

    let insecure = commands::pair(&env.paths, "http://aegis.example.com", &Secret::new(code())).unwrap_err().to_string();
    assert!(insecure.contains("https://"), "{insecure}");
}

// ── run --once ───────────────────────────────────────────────────────────────

#[test]
fn one_cycle_reports_the_boot_once_and_sends_a_heartbeat() {
    let env = env();
    let server = healthy_api();
    paired_config(&server.url).create(&env.paths).unwrap();
    let log = CapturedLog::default();
    let exit = run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap();
    assert_eq!(exit, RunExit::Completed);

    let heartbeats = server.requests_to("/heartbeat");
    assert_eq!(heartbeats.len(), 1);
    assert_eq!(heartbeats[0].path, format!("/api/workspaces/{WORKSPACE}/hosts/{HOST}/heartbeat"));
    assert_eq!(heartbeats[0].header("authorization"), Some(format!("Bearer {}", token()).as_str()));
    assert_eq!(heartbeats[0].json(), json!({}));

    let batches = server.requests_to("/events/ingest");
    assert_eq!(batches.len(), 1);
    let events = batches[0].json()["events"].clone();
    let boot = &events[0];
    assert_eq!(boot["schemaVersion"], 1);
    assert_eq!(boot["category"], "SYSTEM");
    assert_eq!(boot["type"], "SYSTEM_BOOT");
    assert_eq!(boot["occurredAt"], "2026-11-15T17:52:19.000Z");
    assert_eq!(boot["data"], json!({ "system": { "eventType": "BOOT" } }));
    assert_eq!(boot.as_object().unwrap().len(), 6, "no field beyond the contract");
    assert_eq!(pending(&env), 0);

    // The same boot is not reported again by a new run.
    run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap();
    assert_eq!(server.requests_to("/events/ingest").len(), 1);
    assert_eq!(server.requests_to("/heartbeat").len(), 2);
    assert_no_secret(&log.text());
}

#[test]
fn an_unavailable_api_keeps_events_and_a_later_run_delivers_the_same_ids() {
    let env = env();
    paired_config(&closed_port_url()).create(&env.paths).unwrap();
    let log = CapturedLog::default();
    assert_eq!(run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap(), RunExit::Completed);
    assert_eq!(pending(&env), 1);
    assert!(log.text().contains("preservados"), "{}", log.text());

    // The API comes back (same host, same paths): the queued boot is delivered with its original id.
    let server = healthy_api();
    CollectorConfig::remove(&env.paths).unwrap();
    paired_config(&server.url).create(&env.paths).unwrap();
    let queued_id = Spool::open(&env.paths.spool_file(HOST), DEFAULT_LIMITS).unwrap().next_batch(1).unwrap()[0].source_event_id.clone();
    run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap();
    let sent = server.requests_to("/events/ingest");
    assert_eq!(sent[0].json()["events"][0]["sourceEventId"], Value::String(queued_id));
    assert_eq!(pending(&env), 0);
    assert_no_secret(&log.text());
}

#[test]
fn a_revoked_credential_stops_transmission_and_keeps_the_queue() {
    let env = env();
    let server = MockServer::start(|_| {
        Reply::json(401, json!({ "error": { "code": "AUTHENTICATION_ERROR", "message": "Não autenticado." } })).with_header("WWW-Authenticate", "Bearer")
    });
    paired_config(&server.url).create(&env.paths).unwrap();
    let log = CapturedLog::default();
    let exit = run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap();
    assert_eq!(exit, RunExit::Fatal(Fatal::CredentialRejected));
    assert_eq!(server.requests().len(), 1, "no retry loop after a 401");
    assert_eq!(pending(&env), 1);
    assert!(log.text().contains("recusou a credencial"));
    assert!(commands::status(&env.paths).unwrap().contains("CredentialRejected"));
    assert_no_secret(&log.text());
}

#[test]
fn a_401_on_ingestion_after_an_accepted_heartbeat_also_stops() {
    let env = env();
    let server = MockServer::start(|request| {
        if request.path.ends_with("/heartbeat") { Reply::json(200, json!({ "heartbeatIntervalSeconds": 30 })) } else { Reply::json(401, json!({})) }
    });
    paired_config(&server.url).create(&env.paths).unwrap();
    let exit = run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap();
    assert_eq!(exit, RunExit::Fatal(Fatal::CredentialRejected));
    assert_eq!(server.requests_to("/events/ingest").len(), 1);
    assert_eq!(pending(&env), 1);
}

#[test]
fn a_credential_without_heartbeat_scope_still_delivers_events() {
    let env = env();
    let server = MockServer::start(|request| {
        if request.path.ends_with("/heartbeat") {
            Reply::json(403, json!({ "error": { "code": "FORBIDDEN" } }))
        } else {
            Reply::json(200, json!({ "received": request.json()["events"].as_array().map_or(0, Vec::len) }))
        }
    });
    paired_config(&server.url).create(&env.paths).unwrap();
    let log = CapturedLog::default();
    assert_eq!(run(&env.paths, &options(&env, SystemdSource::Disabled, true), &log.logger(), &AtomicBool::new(false)).unwrap(), RunExit::Completed);
    assert_eq!(pending(&env), 0);
    assert!(log.text().contains("replace-credential"));
}

#[test]
fn a_429_is_respected_and_nothing_is_lost() {
    let env = env();
    let server = MockServer::start(|request| {
        if request.path.ends_with("/heartbeat") { Reply::json(200, json!({})) } else { Reply::json(429, json!({})).with_header("Retry-After", "60") }
    });
    paired_config(&server.url).create(&env.paths).unwrap();
    assert_eq!(
        run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap(),
        RunExit::Completed
    );
    assert_eq!(server.requests_to("/events/ingest").len(), 1, "waits instead of hammering");
    assert_eq!(pending(&env), 1);
}

#[test]
fn a_redirect_is_not_followed_and_the_credential_goes_nowhere_else() {
    let env = env();
    let elsewhere = MockServer::start(|_| Reply::json(200, json!({})));
    let target = format!("{}/capturar", elsewhere.url);
    let server = MockServer::start(move |_| Reply::json(302, json!({})).with_header("Location", &target));
    paired_config(&server.url).create(&env.paths).unwrap();
    run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap();
    assert!(elsewhere.requests().is_empty());
    assert_eq!(pending(&env), 1);
}

#[test]
fn an_oversized_response_is_refused_unread() {
    let env = env();
    let server = MockServer::start(|request| {
        if request.path.ends_with("/heartbeat") { Reply::json(200, json!({})) } else { Reply { status: 200, headers: vec![], body: vec![b'x'; 200 * 1024] } }
    });
    paired_config(&server.url).create(&env.paths).unwrap();
    run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap();
    assert_eq!(pending(&env), 1, "an unreadable answer is not a confirmation");
}

// ── the loop: services, heartbeat and controlled shutdown ────────────────────

const UNITS: &str = "\
sshd.service          loaded active   running OpenSSH server daemon
chronyd.service       loaded active   running NTP client/server
cups.service          loaded inactive dead    CUPS Scheduler
";

#[test]
fn the_loop_reports_real_service_changes_only_and_stops_on_request() {
    let env = env();
    let server = healthy_api();
    paired_config(&server.url).create(&env.paths).unwrap();
    let (systemctl, fixture) = fake_systemctl(&env, UNITS);
    let log = CapturedLog::default();
    let shutdown = Arc::new(AtomicBool::new(false));
    let exit = Arc::new(Mutex::new(None));
    let worker = {
        let (paths, options, logger, shutdown, exit) =
            (env.paths.clone(), options(&env, SystemdSource::Program(systemctl), false), log.logger(), shutdown.clone(), exit.clone());
        thread::spawn(move || *exit.lock().unwrap() = Some(run(&paths, &options, &logger, &shutdown).unwrap()))
    };

    let wait_for = |what: &dyn Fn() -> bool| {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !what() {
            assert!(Instant::now() < deadline, "timed out; log:\n{}", log.text());
            thread::sleep(Duration::from_millis(50));
        }
    };
    let service_events = || -> Vec<Value> {
        server
            .requests_to("/events/ingest")
            .iter()
            .flat_map(|r| r.json()["events"].as_array().cloned().unwrap_or_default())
            .filter(|e| e["type"] == "SYSTEM_SERVICE_STATE_CHANGED")
            .collect()
    };
    wait_for(&|| log.text().contains("linha de base de serviços") && !server.requests_to("/heartbeat").is_empty());
    thread::sleep(Duration::from_millis(400));
    assert!(service_events().is_empty(), "the baseline produces no events");

    fs::write(
        &fixture,
        UNITS
            .replace("sshd.service          loaded active   running", "sshd.service          loaded failed   failed ")
            .replace("cups.service          loaded inactive dead ", "cups.service          loaded active   running"),
    )
    .unwrap();
    wait_for(&|| service_events().len() >= 2);
    thread::sleep(Duration::from_millis(400));
    let events = service_events();
    assert_eq!(events.len(), 2, "each change is reported once: {events:?}");
    let mut changes: Vec<(String, String)> =
        events.iter().map(|e| (e["data"]["system"]["serviceName"].as_str().unwrap().into(), e["data"]["system"]["state"].as_str().unwrap().into())).collect();
    changes.sort();
    assert_eq!(changes, [("cups.service".to_string(), "RUNNING".to_string()), ("sshd.service".to_string(), "FAILED".to_string())]);
    for event in &events {
        assert_eq!(event["data"]["system"]["eventType"], "SERVICE_STATE_CHANGED");
        assert_eq!(event["data"]["system"].as_object().unwrap().len(), 3);
        assert_eq!(event["sourceEventId"].as_str().unwrap().len(), 36);
    }

    // A failed query is not "every service stopped".
    fs::write(&fixture, "").unwrap();
    fs::remove_file(&fixture).unwrap();
    thread::sleep(Duration::from_millis(500));
    assert_eq!(service_events().len(), 2);

    shutdown.store(true, Ordering::SeqCst);
    worker.join().unwrap();
    assert_eq!(*exit.lock().unwrap(), Some(RunExit::Stopped));
    assert!(log.text().contains("encerrando"));
    assert_no_secret(&log.text());
}

#[test]
fn only_one_collector_runs_per_host() {
    let env = env();
    let server = healthy_api();
    paired_config(&server.url).create(&env.paths).unwrap();
    let shutdown = Arc::new(AtomicBool::new(false));
    let worker = {
        let (paths, options, shutdown) = (env.paths.clone(), options(&env, SystemdSource::Disabled, false), shutdown.clone());
        thread::spawn(move || run(&paths, &options, &CapturedLog::default().logger(), &shutdown).unwrap())
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while server.requests_to("/heartbeat").is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    let second = run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap_err();
    assert!(second.contains("em execução"), "{second}");
    shutdown.store(true, Ordering::SeqCst);
    assert_eq!(worker.join().unwrap(), RunExit::Stopped);
}

// ── credential lifecycle ─────────────────────────────────────────────────────

#[test]
fn replace_credential_verifies_before_writing() {
    let env = env();
    let refusing = MockServer::start(|_| Reply::json(401, json!({})));
    paired_config(&refusing.url).create(&env.paths).unwrap();
    let error = commands::replace_credential(&env.paths, &Secret::new(rotated_token())).unwrap_err().to_string();
    assert!(error.contains("nada foi alterado"), "{error}");
    assert_eq!(CollectorConfig::load(&env.paths).unwrap().unwrap().token.expose(), token());
    assert_no_secret(&error);

    CollectorConfig::remove(&env.paths).unwrap();
    let server = healthy_api();
    paired_config(&server.url).create(&env.paths).unwrap();
    let updated = commands::replace_credential(&env.paths, &Secret::new(rotated_token())).unwrap();
    assert_eq!(updated.credential_id, rotated_credential());
    assert_eq!(server.requests_to("/heartbeat")[0].header("authorization"), Some(format!("Bearer {}", rotated_token()).as_str()));
    let stored = CollectorConfig::load(&env.paths).unwrap().unwrap();
    assert_eq!((stored.token.expose(), stored.host_id.as_str()), (rotated_token().as_str(), HOST));
    assert_eq!(fs::metadata(env.paths.config_file()).unwrap().mode() & 0o777, 0o600);

    let malformed = commands::replace_credential(&env.paths, &Secret::new("aegis_agent_x".into())).unwrap_err().to_string();
    assert!(malformed.contains("formato"));
}

#[test]
fn unpair_removes_only_local_files_and_keeps_the_queue() {
    let env = env();
    paired_config(&closed_port_url()).create(&env.paths).unwrap();
    run(&env.paths, &options(&env, SystemdSource::Disabled, true), &CapturedLog::default().logger(), &AtomicBool::new(false)).unwrap();
    match commands::unpair(&env.paths).unwrap() {
        commands::UnpairOutcome::Removed { host_id, pending, spool } => {
            assert_eq!((host_id.as_str(), pending), (HOST, 1));
            assert!(spool.exists());
        }
        commands::UnpairOutcome::NothingToRemove => panic!("expected a removal"),
    }
    assert!(!CollectorConfig::exists(&env.paths));
    assert!(matches!(commands::unpair(&env.paths).unwrap(), commands::UnpairOutcome::NothingToRemove));
    assert!(commands::status(&env.paths).unwrap().starts_with("Não pareado"));
    let _ = Path::new(&env.root.path());
}

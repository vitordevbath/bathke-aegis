//! Aegis Collector: an explicit, user-run Linux agent for Bathke Aegis.
//!
//! It pairs with one host through a one-time code, keeps the resulting machine
//! credential in a private file, reports SYSTEM events (boot and systemd
//! service state changes) through a persistent local queue and sends a
//! heartbeat. It never captures command lines, environment, file or log
//! contents, keystrokes or network payloads, and it never executes anything
//! received from the server.

pub mod boot;
pub mod cli;
pub mod commands;
pub mod config;
pub mod delivery;
pub mod event;
pub mod http;
pub mod logger;
pub mod paths;
pub mod run;
pub mod secure_fs;
pub mod server_url;
pub mod services;
pub mod spool;
pub mod systemctl;
pub mod time;

/// Version reported by `--version` and in the HTTP `User-Agent`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

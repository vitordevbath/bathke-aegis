//! Reads service states from systemd without privileges: a fixed absolute
//! path, fixed arguments, no shell, a cleared environment, a timeout and an
//! output cap. Nothing from the server or the user reaches the command line.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const LIST_UNITS_ARGS: [&str; 7] = ["list-units", "--type=service", "--all", "--plain", "--no-legend", "--no-pager", "--quiet"];
const CANDIDATES: [&str; 2] = ["/usr/bin/systemctl", "/bin/systemctl"];
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum QueryError {
    Unavailable,
    Spawn,
    Timeout,
    OutputTooLarge,
    Failed(Option<i32>),
    NotUtf8,
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable => f.write_str("systemd não está disponível neste sistema"),
            Self::Spawn => f.write_str("não foi possível executar systemctl"),
            Self::Timeout => f.write_str("systemctl não respondeu dentro do tempo limite"),
            Self::OutputTooLarge => f.write_str("saída do systemctl acima do limite"),
            Self::Failed(code) => write!(f, "systemctl terminou com código {code:?}"),
            Self::NotUtf8 => f.write_str("saída do systemctl não é texto UTF-8"),
        }
    }
}

impl std::error::Error for QueryError {}

/// The systemd manager is running (the check `sd_booted()` uses) and `systemctl` exists at a fixed path.
pub fn locate(run_root: &Path) -> Option<PathBuf> {
    if !run_root.join("run/systemd/system").is_dir() {
        return None;
    }
    CANDIDATES.iter().map(PathBuf::from).find(|path| path.is_file())
}

/// Runs `program` with `args`, bounded in time and output.
pub fn run_bounded(program: &Path, args: &[&str], timeout: Duration, max_output: usize) -> Result<String, QueryError> {
    let mut child = Command::new(program)
        .args(args)
        .env_clear()
        .env("LC_ALL", "C")
        .env("SYSTEMD_COLORS", "0")
        .env("SYSTEMD_PAGER", "")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| QueryError::Spawn)?;
    let stdout = child.stdout.take().ok_or(QueryError::Spawn)?;
    // Reading in another thread keeps the pipe drained while we wait; dropping it
    // after the cap makes a runaway writer fail instead of blocking forever.
    let reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.take(max_output as u64 + 1).read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(QueryError::Timeout);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return Err(QueryError::Spawn),
        }
    };
    let output = reader.join().map_err(|_| QueryError::Spawn)?;
    if output.len() > max_output {
        return Err(QueryError::OutputTooLarge);
    }
    if !status.success() {
        return Err(QueryError::Failed(status.code()));
    }
    String::from_utf8(output).map_err(|_| QueryError::NotUtf8)
}

pub fn list_service_units(systemctl: &Path) -> Result<String, QueryError> {
    run_bounded(systemctl, &LIST_UNITS_ARGS, DEFAULT_TIMEOUT, MAX_OUTPUT_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_a_running_systemd() {
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(locate(empty.path()), None);
    }

    #[test]
    fn enforces_timeout_and_output_cap_and_reports_failures() {
        let sh = Path::new("/bin/sh");
        assert_eq!(run_bounded(sh, &["-c", "echo ok"], Duration::from_secs(5), 1024).unwrap(), "ok\n");
        assert_eq!(run_bounded(sh, &["-c", "sleep 5"], Duration::from_millis(200), 1024), Err(QueryError::Timeout));
        assert_eq!(run_bounded(sh, &["-c", "head -c 5000 /dev/zero | tr '\\\\0' a"], Duration::from_secs(5), 1000), Err(QueryError::OutputTooLarge));
        assert_eq!(run_bounded(sh, &["-c", "exit 3"], Duration::from_secs(5), 1024), Err(QueryError::Failed(Some(3))));
        assert_eq!(run_bounded(Path::new("/nao/existe"), &[], Duration::from_secs(1), 1024), Err(QueryError::Spawn));
    }

    #[test]
    fn runs_with_an_empty_environment() {
        // Nothing of this process's environment (HOME, PATH, any secret) reaches the child.
        let output = run_bounded(Path::new("/usr/bin/env"), &[], Duration::from_secs(5), 64 * 1024).unwrap();
        let mut names: Vec<&str> = output.lines().filter_map(|line| line.split('=').next()).collect();
        names.sort_unstable();
        assert_eq!(names, ["LC_ALL", "SYSTEMD_COLORS", "SYSTEMD_PAGER"]);
    }

    #[test]
    fn lists_real_units_when_systemd_runs() {
        if let Some(systemctl) = locate(Path::new("/")) {
            let output = list_service_units(&systemctl).unwrap();
            assert!(!crate::services::parse_list_units(&output).is_empty());
        }
    }
}

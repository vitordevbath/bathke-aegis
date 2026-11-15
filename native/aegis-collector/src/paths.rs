//! Where the Collector keeps its files, following the XDG base directories of
//! the user who runs it. Nothing is installed system-wide.

use std::env;
use std::path::{Path, PathBuf};

const APP: &str = "aegis-collector";

#[derive(Clone, Debug)]
pub struct Paths {
    /// Holds `config.json` (server, host identity and the machine credential).
    pub config_dir: PathBuf,
    /// Holds one queue per paired host: `hosts/<hostId>/spool.sqlite3`.
    pub state_dir: PathBuf,
}

impl Paths {
    /// `$XDG_CONFIG_HOME/aegis-collector` and `$XDG_STATE_HOME/aegis-collector`,
    /// falling back to `~/.config` and `~/.local/state`. Relative XDG values are
    /// ignored, as the specification requires.
    pub fn from_environment() -> Result<Self, String> {
        let home = env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute());
        let xdg = |name: &str| env::var_os(name).map(PathBuf::from).filter(|p| p.is_absolute());
        let config_base = xdg("XDG_CONFIG_HOME").or_else(|| home.as_ref().map(|h| h.join(".config")));
        let state_base = xdg("XDG_STATE_HOME").or_else(|| home.as_ref().map(|h| h.join(".local/state")));
        match (config_base, state_base) {
            (Some(config), Some(state)) => Ok(Self::under(&config, &state)),
            _ => Err("não foi possível determinar o diretório do usuário (HOME ou XDG_CONFIG_HOME/XDG_STATE_HOME)".into()),
        }
    }

    pub fn under(config_base: &Path, state_base: &Path) -> Self {
        Self { config_dir: config_base.join(APP), state_dir: state_base.join(APP) }
    }

    pub fn config_file(&self) -> PathBuf {
        self.config_dir.join("config.json")
    }

    /// The queue belongs to a host: pairing with another host never sends its events.
    pub fn host_state_dir(&self, host_id: &str) -> PathBuf {
        self.state_dir.join("hosts").join(host_id)
    }

    pub fn spool_file(&self, host_id: &str) -> PathBuf {
        self.host_state_dir(host_id).join("spool.sqlite3")
    }
}

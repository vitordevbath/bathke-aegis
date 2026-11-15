//! The local pairing record. The machine credential lives only here, in a
//! `0600` file inside a `0700` directory (see `secure_fs`); it is never
//! printed, logged, passed on a command line or stored in the event queue.

use std::fmt;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::paths::Paths;
use crate::secure_fs::{self, SecureFsError};
use crate::server_url::ServerUrl;

pub const CONFIG_VERSION: u32 = 1;
pub const TOKEN_PREFIX: &str = "aegis_agent_";
pub const PAIRING_CODE_PREFIX: &str = "aegis_pair_";

/// A secret string whose `Debug` never shows the value and which has no `Display`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// The only way to read the value: used to build the `Authorization` header.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<oculto>)")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectorConfig {
    pub version: u32,
    pub server: String,
    pub workspace_id: String,
    pub host_id: String,
    pub credential_id: String,
    pub scopes: Vec<String>,
    pub paired_at: String,
    pub token: Secret,
}

#[derive(Debug)]
pub enum ConfigError {
    Fs(SecureFsError),
    Invalid(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fs(error) => write!(f, "{error}"),
            Self::Invalid(reason) => write!(f, "configuração local inválida: {reason}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<SecureFsError> for ConfigError {
    fn from(error: SecureFsError) -> Self {
        Self::Fs(error)
    }
}

pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(b),
        })
}

fn is_secret_part(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// `aegis_pair_` followed by 43 base64url characters, as issued by the panel.
pub fn is_pairing_code(value: &str) -> bool {
    value.strip_prefix(PAIRING_CODE_PREFIX).is_some_and(is_secret_part)
}

/// `aegis_agent_<credential id without dashes>.<43 base64url>`, for the given credential.
pub fn is_machine_token_for(token: &str, credential_id: &str) -> bool {
    let Some(rest) = token.strip_prefix(TOKEN_PREFIX) else { return false };
    let Some((hex, secret)) = rest.split_once('.') else { return false };
    hex == credential_id.replace('-', "") && is_secret_part(secret)
}

impl CollectorConfig {
    /// Fails closed: anything unexpected makes the file unusable instead of half-trusted.
    pub fn validate(&self) -> Result<(), ConfigError> {
        let invalid = |reason: &str| Err(ConfigError::Invalid(reason.into()));
        if self.version != CONFIG_VERSION {
            return invalid("versão desconhecida");
        }
        if ServerUrl::parse(&self.server).is_err() {
            return invalid("endereço do servidor");
        }
        if !is_uuid(&self.workspace_id) || !is_uuid(&self.host_id) || !is_uuid(&self.credential_id) {
            return invalid("identificadores");
        }
        if !is_machine_token_for(self.token.expose(), &self.credential_id) {
            return invalid("credencial");
        }
        if self.scopes.is_empty() || self.scopes.iter().any(|s| s.len() > 64 || !s.chars().all(|c| c.is_ascii_lowercase() || c == ':' || c == '_')) {
            return invalid("escopos");
        }
        Ok(())
    }

    pub fn server_url(&self) -> ServerUrl {
        // validate() already accepted it.
        ServerUrl::parse(&self.server).unwrap_or_else(|_| unreachable!("validated server url"))
    }

    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }

    /// Public, non-secret label of the credential, the same the panel shows.
    pub fn credential_label(&self) -> String {
        format!("{TOKEN_PREFIX}{}", &self.credential_id.replace('-', "")[..8])
    }

    pub fn load(paths: &Paths) -> Result<Option<Self>, ConfigError> {
        secure_fs::ensure_private_dir(&paths.config_dir)?;
        let Some(bytes) = secure_fs::read_private_file(&paths.config_file())? else { return Ok(None) };
        let config: Self = serde_json::from_slice(&bytes).map_err(|_| ConfigError::Invalid("JSON".into()))?;
        config.validate()?;
        Ok(Some(config))
    }

    /// Writes a new configuration; an existing one is never replaced (`unpair` first).
    pub fn create(&self, paths: &Paths) -> Result<(), ConfigError> {
        self.validate()?;
        let json = serde_json::to_vec_pretty(self).map_err(|_| ConfigError::Invalid("serialização".into()))?;
        secure_fs::create_private_file(&paths.config_file(), &json)?;
        Ok(())
    }

    pub fn remove(paths: &Paths) -> Result<bool, ConfigError> {
        Ok(secure_fs::remove_private_file(&paths.config_file())?)
    }

    pub fn exists(paths: &Paths) -> bool {
        Path::new(&paths.config_file()).symlink_metadata().is_ok()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const CREDENTIAL_ID: &str = "1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab";

    /// A syntactically valid token assembled at runtime; never a real secret.
    pub fn sample_token() -> String {
        format!("{TOKEN_PREFIX}{}.{}", CREDENTIAL_ID.replace('-', ""), "Q".repeat(21) + "-_" + &"z".repeat(20))
    }

    pub fn sample() -> CollectorConfig {
        CollectorConfig {
            version: CONFIG_VERSION,
            server: "http://localhost:8080".into(),
            workspace_id: "0b6c2f1e-0000-4000-8000-0000000000aa".into(),
            host_id: "0b6c2f1e-0000-4000-8000-0000000000bb".into(),
            credential_id: CREDENTIAL_ID.into(),
            scopes: vec!["events:ingest".into(), "host:heartbeat".into()],
            paired_at: "2026-11-15T10:00:00.000Z".into(),
            token: Secret::new(sample_token()),
        }
    }

    #[test]
    fn debug_output_never_contains_the_credential() {
        let config = sample();
        let debug = format!("{config:?}");
        assert!(!debug.contains(config.token.expose()));
        assert!(debug.contains("<oculto>"));
        assert_eq!(config.credential_label(), "aegis_agent_1a2b3c4d");
    }

    #[test]
    fn round_trips_through_a_private_file() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths::under(&root.path().join("config"), &root.path().join("state"));
        assert!(CollectorConfig::load(&paths).unwrap().is_none());
        sample().create(&paths).unwrap();
        assert_eq!(CollectorConfig::load(&paths).unwrap().unwrap(), sample());
        assert!(matches!(sample().create(&paths), Err(ConfigError::Fs(SecureFsError::AlreadyExists(_)))));
        assert!(CollectorConfig::remove(&paths).unwrap());
        assert!(!CollectorConfig::exists(&paths));
    }

    #[test]
    fn refuses_tampered_or_unknown_content() {
        let mut wrong_token = sample();
        wrong_token.token = Secret::new(sample_token().replace("1a2b3c4d", "ffffffff"));
        assert!(wrong_token.validate().is_err());
        let mut remote_http = sample();
        remote_http.server = "http://10.0.0.5:8080".into();
        assert!(remote_http.validate().is_err());
        let mut bad_id = sample();
        bad_id.host_id = "../../etc".into();
        assert!(bad_id.validate().is_err());

        let root = tempfile::tempdir().unwrap();
        let paths = Paths::under(&root.path().join("config"), &root.path().join("state"));
        let mut json: serde_json::Value = serde_json::to_value(sample()).unwrap();
        json["extra"] = serde_json::json!(true);
        secure_fs::create_private_file(&paths.config_file(), json.to_string().as_bytes()).unwrap();
        assert!(matches!(CollectorConfig::load(&paths), Err(ConfigError::Invalid(_))));
    }

    #[test]
    fn recognizes_codes_and_tokens_by_shape_only() {
        assert!(is_pairing_code(&format!("{PAIRING_CODE_PREFIX}{}", "A".repeat(43))));
        assert!(!is_pairing_code(&format!("{PAIRING_CODE_PREFIX}{}", "A".repeat(42))));
        assert!(!is_pairing_code("aegis_pair_com espaço"));
        assert!(is_machine_token_for(&sample_token(), CREDENTIAL_ID));
        assert!(is_uuid(CREDENTIAL_ID));
        assert!(!is_uuid("1A2B3C4D-5E6F-4A1B-8C2D-0123456789AB"));
    }
}

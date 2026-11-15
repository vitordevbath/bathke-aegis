//! `pair`, `status`, `replace-credential` and `unpair`. Secrets enter only as
//! `Secret` values read by `main` from the terminal; outputs and errors here
//! never include them.

use std::fmt;
use std::time::SystemTime;

use serde_json::Value;

use crate::config::{self, CONFIG_VERSION, CollectorConfig, ConfigError, Secret};
use crate::delivery::{HeartbeatVerdict, classify_heartbeat};
use crate::http::{ApiClient, MachineApi, MachineTransport};
use crate::paths::Paths;
use crate::secure_fs;
use crate::server_url::ServerUrl;
use crate::spool::{DEFAULT_LIMITS, Spool};
use crate::time::rfc3339_utc;

#[derive(Debug)]
pub struct CommandError(pub String);

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CommandError {}

impl From<ConfigError> for CommandError {
    fn from(error: ConfigError) -> Self {
        Self(error.to_string())
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, CommandError> {
    Err(CommandError(message.into()))
}

/// Trades a one-time pairing code for this host's machine credential and stores it locally.
pub fn pair(paths: &Paths, server: &str, code: &Secret) -> Result<CollectorConfig, CommandError> {
    let server = ServerUrl::parse(server).map_err(|e| CommandError(e.to_string()))?;
    if CollectorConfig::exists(paths) {
        return fail(format!(
            "este usuário já tem um Collector pareado ({}). Para parear de novo, execute `aegis-collector unpair` primeiro.",
            paths.config_file().display()
        ));
    }
    if !config::is_pairing_code(code.expose()) {
        return fail("o valor informado não tem o formato de um código de pareamento do Aegis (aegis_pair_…); copie-o novamente do painel");
    }
    let response = ApiClient::new(server.clone()).pair(code).map_err(|e| CommandError(format!("não foi possível contatar {server}: {e}")))?;
    match response.status {
        201 => {}
        401 => return fail("código recusado: inválido, expirado, já usado ou cancelado. Gere um novo código no painel."),
        429 => {
            let wait = response.retry_after.map(|d| format!(" Aguarde {}s.", d.as_secs())).unwrap_or_default();
            return fail(format!("muitas tentativas de pareamento a partir deste endereço.{wait}"));
        }
        status => return fail(format!("resposta inesperada do servidor ao parear (HTTP {status})")),
    }
    let body = response.json().ok_or_else(|| CommandError("resposta de pareamento ilegível".into()))?;
    let text =
        |field: &str| body.get(field).and_then(Value::as_str).map(str::to_string).ok_or_else(|| CommandError("resposta de pareamento incompleta".into()));
    let scopes = body
        .get("scopes")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default();
    let config = CollectorConfig {
        version: CONFIG_VERSION,
        server: server.to_string(),
        workspace_id: text("workspaceId")?,
        host_id: text("hostId")?,
        credential_id: text("credentialId")?,
        scopes,
        paired_at: rfc3339_utc(SystemTime::now()),
        token: Secret::new(text("token")?),
    };
    config.validate().map_err(|_| CommandError("o servidor devolveu uma credencial em formato inesperado; nada foi gravado".into()))?;
    config.create(paths)?;
    Ok(config)
}

/// Installs the credential an OWNER obtained by rotating it in the panel.
/// The new credential is verified with a heartbeat before anything is written.
pub fn replace_credential(paths: &Paths, token: &Secret) -> Result<CollectorConfig, CommandError> {
    let current = CollectorConfig::load(paths)?.ok_or_else(|| CommandError("este usuário não tem Collector pareado; use `aegis-collector pair`".into()))?;
    let Some(hex) = token.expose().strip_prefix(config::TOKEN_PREFIX).and_then(|rest| rest.split_once('.')).map(|(hex, _)| hex.to_string()) else {
        return fail("o valor informado não tem o formato de uma credencial de máquina do Aegis (aegis_agent_…)");
    };
    if hex.len() != 32 {
        return fail("o valor informado não tem o formato de uma credencial de máquina do Aegis (aegis_agent_…)");
    }
    let credential_id = format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..]);
    let mut next = CollectorConfig { credential_id, token: token.clone(), paired_at: rfc3339_utc(SystemTime::now()), ..current.clone() };
    next.validate().map_err(|_| CommandError("o valor informado não tem o formato de uma credencial de máquina do Aegis (aegis_agent_…)".into()))?;

    match classify_heartbeat(MachineApi::new(&next).heartbeat()) {
        HeartbeatVerdict::Recorded { .. } => next.scopes = vec!["events:ingest".into(), "host:heartbeat".into()],
        HeartbeatVerdict::NotAllowed => next.scopes = vec!["events:ingest".into()],
        HeartbeatVerdict::Fatal(crate::delivery::Fatal::CredentialRejected) => {
            return fail("o servidor recusou esta credencial (inválida, já substituída ou revogada); nada foi alterado");
        }
        HeartbeatVerdict::Fatal(_) => return fail("esta credencial pertence a outro host; nada foi alterado. Use `unpair` e `pair` para trocar de host."),
        HeartbeatVerdict::RateLimited(_) | HeartbeatVerdict::Retry(_) => {
            return fail("não foi possível verificar a credencial com o servidor agora; nada foi alterado. Tente novamente.");
        }
    }
    let json = serde_json::to_vec_pretty(&next).map_err(|_| CommandError("falha ao serializar a configuração".into()))?;
    secure_fs::replace_private_file(&paths.config_file(), &json).map_err(|e| CommandError(e.to_string()))?;
    Ok(next)
}

pub enum UnpairOutcome {
    NothingToRemove,
    Removed { host_id: String, pending: i64, spool: std::path::PathBuf },
}

/// Removes the local configuration. The credential stays valid on the server until revoked in the panel.
pub fn unpair(paths: &Paths) -> Result<UnpairOutcome, CommandError> {
    let Some(config) = CollectorConfig::load(paths)? else { return Ok(UnpairOutcome::NothingToRemove) };
    let spool_path = paths.spool_file(&config.host_id);
    let pending = if spool_path.exists() { Spool::open(&spool_path, DEFAULT_LIMITS).and_then(|s| s.stats()).map(|s| s.pending).unwrap_or(0) } else { 0 };
    CollectorConfig::remove(paths)?;
    Ok(UnpairOutcome::Removed { host_id: config.host_id, pending, spool: spool_path })
}

/// A report for the operator. The credential appears only by its public label.
pub fn status(paths: &Paths) -> Result<String, CommandError> {
    let Some(config) = CollectorConfig::load(paths)? else {
        return Ok(format!("Não pareado. Configuração esperada em {}.\nPara parear: aegis-collector pair --server <URL>", paths.config_file().display()));
    };
    let mut lines = vec![
        "Aegis Collector — pareado".to_string(),
        format!("  Servidor:            {}", config.server),
        format!("  Workspace:           {}", config.workspace_id),
        format!("  Host:                {}", config.host_id),
        format!("  Credencial:          {} (o segredo nunca é exibido)", config.credential_label()),
        format!("  Escopos:             {}", config.scopes.join(", ")),
        format!("  Pareado/atualizado:  {}", config.paired_at),
        format!("  Configuração:        {} (0600, diretório 0700)", paths.config_file().display()),
    ];
    if !config.has_scope("host:heartbeat") {
        lines.push("  Aviso: esta credencial não permite heartbeat. Rotacione-a no painel e use `aegis-collector replace-credential`.".into());
    }
    let spool_path = paths.spool_file(&config.host_id);
    if spool_path.exists() {
        let spool = Spool::open(&spool_path, DEFAULT_LIMITS).map_err(|e| CommandError(e.to_string()))?;
        let stats = spool.stats().map_err(|e| CommandError(e.to_string()))?;
        let state = |key: &str| spool.state(key).ok().flatten().unwrap_or_else(|| "nunca".into());
        lines.push(format!("  Fila local:          {}", spool_path.display()));
        lines.push(format!(
            "    pendentes {} · em quarentena {} · recusados por fila cheia {} · {} bytes",
            stats.pending, stats.quarantined, stats.dropped, stats.bytes
        ));
        lines.push(format!("    último heartbeat aceito: {}", state("last_heartbeat_at")));
        lines.push(format!("    último envio de eventos aceito: {}", state("last_delivery_at")));
        if let Some(error) = spool.state("last_error").ok().flatten() {
            lines.push(format!("    último erro: {error}"));
        }
    } else {
        lines.push("  Fila local:          ainda não criada (execute `aegis-collector run`)".into());
    }
    Ok(lines.join("\n"))
}

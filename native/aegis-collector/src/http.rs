//! One HTTP client for every call to the API. TLS is always verified against
//! the operating system's trust store; there is no option to disable it.
//! Redirects are not followed (a credential never travels to another address),
//! every call has timeouts and response bodies are capped.

use std::fmt;
use std::time::Duration;

use serde_json::{Value, json};
use ureq::tls::{RootCerts, TlsConfig};

use crate::config::{CollectorConfig, Secret};
use crate::server_url::ServerUrl;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const CALL_TIMEOUT: Duration = Duration::from_secs(20);
/// API responses are small JSON documents; anything larger is refused unread.
pub const MAX_RESPONSE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiResponse {
    pub status: u16,
    pub retry_after: Option<Duration>,
    pub body: Vec<u8>,
}

impl ApiResponse {
    pub fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// Why no HTTP response arrived. The text never contains URLs with secrets,
/// headers or bodies: only the kind of failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    Timeout,
    Connect,
    Dns,
    Tls,
    Redirect,
    ResponseTooLarge,
    Other(&'static str),
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Timeout => "tempo limite esgotado",
            Self::Connect => "falha de conexão",
            Self::Dns => "servidor não encontrado (DNS)",
            Self::Tls => "falha de TLS (certificado inválido ou não confiável)",
            Self::Redirect => "o servidor respondeu com redirecionamento, que não é seguido",
            Self::ResponseTooLarge => "resposta maior que o limite",
            Self::Other(kind) => kind,
        })
    }
}

impl std::error::Error for TransportError {}

fn map_error(error: ureq::Error) -> TransportError {
    match error {
        ureq::Error::Timeout(_) => TransportError::Timeout,
        ureq::Error::ConnectionFailed => TransportError::Connect,
        ureq::Error::HostNotFound => TransportError::Dns,
        ureq::Error::Tls(_) => TransportError::Tls,
        ureq::Error::TooManyRedirects | ureq::Error::RedirectFailed => TransportError::Redirect,
        ureq::Error::BodyExceedsLimit(_) => TransportError::ResponseTooLarge,
        ureq::Error::Io(io) => match io.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => TransportError::Timeout,
            std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted => TransportError::Connect,
            _ => TransportError::Other("erro de entrada/saída na conexão"),
        },
        _ => TransportError::Other("erro de protocolo HTTP"),
    }
}

/// `Retry-After` in seconds (the API's form), bounded to one hour.
fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(|s| Duration::from_secs(s.clamp(1, 3600)))
}

#[derive(Clone)]
pub struct ApiClient {
    agent: ureq::Agent,
    server: ServerUrl,
}

impl ApiClient {
    pub fn new(server: ServerUrl) -> Self {
        let tls = TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build();
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .https_only(server.as_str().starts_with("https://"))
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(CALL_TIMEOUT))
            .user_agent(format!("aegis-collector/{}", crate::VERSION))
            .tls_config(tls)
            .build();
        Self { agent: config.into(), server }
    }

    pub fn server(&self) -> &ServerUrl {
        &self.server
    }

    fn post_json(&self, path: &str, bearer: Option<&Secret>, body: &Value) -> Result<ApiResponse, TransportError> {
        let mut request = self.agent.post(self.server.api(path)).header("Accept", "application/json");
        if let Some(token) = bearer {
            request = request.header("Authorization", format!("Bearer {}", token.expose()));
        }
        let mut response = request.send_json(body).map_err(map_error)?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(TransportError::Redirect);
        }
        let retry_after = response.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(parse_retry_after);
        let body = response.body_mut().with_config().limit(MAX_RESPONSE_BYTES).read_to_vec().map_err(map_error)?;
        Ok(ApiResponse { status, retry_after, body })
    }

    /// `POST /api/agent/pair` with only the code: workspace and host come from the server.
    pub fn pair(&self, code: &Secret) -> Result<ApiResponse, TransportError> {
        self.post_json("/agent/pair", None, &json!({ "code": code.expose() }))
    }
}

/// What the run loop needs from the API, so delivery can be tested without a network.
pub trait MachineTransport {
    fn heartbeat(&self) -> Result<ApiResponse, TransportError>;
    fn ingest(&self, events: &[Value]) -> Result<ApiResponse, TransportError>;
}

/// Calls made with the host's machine credential.
pub struct MachineApi {
    client: ApiClient,
    workspace_id: String,
    host_id: String,
    token: Secret,
}

impl MachineApi {
    pub fn new(config: &CollectorConfig) -> Self {
        Self::with_token(config, config.token.clone())
    }

    pub fn with_token(config: &CollectorConfig, token: Secret) -> Self {
        Self { client: ApiClient::new(config.server_url()), workspace_id: config.workspace_id.clone(), host_id: config.host_id.clone(), token }
    }

    fn host_path(&self, suffix: &str) -> String {
        // Both ids were validated as UUIDs when the configuration was loaded.
        format!("/workspaces/{}/hosts/{}{suffix}", self.workspace_id, self.host_id)
    }
}

impl MachineTransport for MachineApi {
    fn heartbeat(&self) -> Result<ApiResponse, TransportError> {
        self.client.post_json(&self.host_path("/heartbeat"), Some(&self.token), &json!({}))
    }

    fn ingest(&self, events: &[Value]) -> Result<ApiResponse, TransportError> {
        self.client.post_json(&self.host_path("/events/ingest"), Some(&self.token), &json!({ "events": events }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_is_bounded_seconds() {
        assert_eq!(parse_retry_after("30"), Some(Duration::from_secs(30)));
        assert_eq!(parse_retry_after("0"), Some(Duration::from_secs(1)));
        assert_eq!(parse_retry_after("999999"), Some(Duration::from_secs(3600)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), None);
    }

    #[test]
    fn transport_errors_describe_the_kind_only() {
        for error in [TransportError::Timeout, TransportError::Connect, TransportError::Tls, TransportError::Redirect] {
            let text = error.to_string();
            assert!(!text.contains("http"), "{text}");
        }
    }
}

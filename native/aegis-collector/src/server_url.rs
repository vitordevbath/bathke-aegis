//! The address of an Aegis installation, validated before any credential can
//! be sent to it: HTTPS for anything remote, plain HTTP only on loopback for
//! local development. No user info, query or fragment; no redirects are
//! followed by the HTTP client either.

use std::fmt;
use std::net::IpAddr;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerUrl {
    /// `scheme://host[:port][/prefix]`, without a trailing slash.
    base: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ServerUrlError {
    Malformed,
    UnsupportedScheme,
    InsecureRemote,
    CredentialsInUrl,
    QueryOrFragment,
}

impl fmt::Display for ServerUrlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Malformed => "endereço do servidor inválido (ex.: https://aegis.exemplo.com ou http://localhost:8080)",
            Self::UnsupportedScheme => "o endereço do servidor deve começar com https:// (ou http:// somente em loopback)",
            Self::InsecureRemote => "HTTP sem TLS só é aceito para localhost/127.0.0.1/::1; use https:// para servidores remotos",
            Self::CredentialsInUrl => "o endereço do servidor não pode conter usuário ou senha",
            Self::QueryOrFragment => "o endereço do servidor não pode conter ? ou #",
        })
    }
}

impl std::error::Error for ServerUrlError {}

impl ServerUrl {
    pub fn parse(raw: &str) -> Result<Self, ServerUrlError> {
        let raw = raw.trim();
        if raw.contains('?') || raw.contains('#') {
            return Err(ServerUrlError::QueryOrFragment);
        }
        let (scheme, rest) = raw.split_once("://").ok_or(ServerUrlError::Malformed)?;
        let scheme = scheme.to_ascii_lowercase();
        if scheme != "https" && scheme != "http" {
            return Err(ServerUrlError::UnsupportedScheme);
        }
        let (authority, path) = match rest.find('/') {
            Some(index) => (&rest[..index], &rest[index..]),
            None => (rest, ""),
        };
        if authority.contains('@') {
            return Err(ServerUrlError::CredentialsInUrl);
        }
        let host = host_of(authority).ok_or(ServerUrlError::Malformed)?;
        if scheme == "http" && !is_loopback(&host) {
            return Err(ServerUrlError::InsecureRemote);
        }
        if path.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(ServerUrlError::Malformed);
        }
        let path = path.trim_end_matches('/');
        Ok(Self { base: format!("{scheme}://{}{path}", authority.to_ascii_lowercase()) })
    }

    /// The API endpoint for `path` (which starts with `/`). The API lives under `/api` behind Nginx.
    pub fn api(&self, path: &str) -> String {
        format!("{}/api{path}", self.base)
    }

    pub fn as_str(&self) -> &str {
        &self.base
    }
}

impl fmt::Display for ServerUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.base)
    }
}

/// Host part of `host`, `host:port`, `[v6]` or `[v6]:port`; None when malformed.
fn host_of(authority: &str) -> Option<String> {
    if authority.is_empty() {
        return None;
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (inside, after) = rest.split_once(']')?;
        let port = match after {
            "" => None,
            p => Some(p.strip_prefix(':')?),
        };
        (inside.to_string(), port)
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (authority.to_string(), None),
        }
    };
    if let Some(port) = port {
        if port.is_empty() || port.parse::<u16>().ok().filter(|p| *p > 0).is_none() {
            return None;
        }
    }
    let valid = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    valid.then(|| host.to_ascii_lowercase())
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_anywhere_and_http_only_on_loopback() {
        assert_eq!(ServerUrl::parse("https://aegis.example.com").unwrap().api("/agent/pair"), "https://aegis.example.com/api/agent/pair");
        assert_eq!(ServerUrl::parse("http://localhost:8080/").unwrap().api("/x"), "http://localhost:8080/api/x");
        assert!(ServerUrl::parse("http://127.0.0.1:8080").is_ok());
        assert!(ServerUrl::parse("http://127.10.0.1").is_ok());
        assert!(ServerUrl::parse("http://[::1]:8080").is_ok());
        assert_eq!(ServerUrl::parse("http://192.168.0.10:8080"), Err(ServerUrlError::InsecureRemote));
        assert_eq!(ServerUrl::parse("http://aegis.example.com"), Err(ServerUrlError::InsecureRemote));
        assert_eq!(ServerUrl::parse("http://localhost.evil.com"), Err(ServerUrlError::InsecureRemote));
    }

    #[test]
    fn keeps_a_path_prefix_and_normalizes_case() {
        let url = ServerUrl::parse("HTTPS://Aegis.Example.com/seguranca/").unwrap();
        assert_eq!(url.as_str(), "https://aegis.example.com/seguranca");
        assert_eq!(url.api("/agent/pair"), "https://aegis.example.com/seguranca/api/agent/pair");
    }

    #[test]
    fn refuses_what_could_leak_or_confuse() {
        assert_eq!(ServerUrl::parse("ftp://x"), Err(ServerUrlError::UnsupportedScheme));
        assert_eq!(ServerUrl::parse("https://user:pass@aegis.example.com"), Err(ServerUrlError::CredentialsInUrl));
        assert_eq!(ServerUrl::parse("https://aegis.example.com/?token=x"), Err(ServerUrlError::QueryOrFragment));
        assert_eq!(ServerUrl::parse("https://aegis.example.com/#x"), Err(ServerUrlError::QueryOrFragment));
        assert_eq!(ServerUrl::parse("aegis.example.com"), Err(ServerUrlError::Malformed));
        assert_eq!(ServerUrl::parse("https://"), Err(ServerUrlError::Malformed));
        assert_eq!(ServerUrl::parse("https://host:99999"), Err(ServerUrlError::Malformed));
        assert_eq!(ServerUrl::parse("https://host:"), Err(ServerUrlError::Malformed));
        assert_eq!(ServerUrl::parse("https://ho st"), Err(ServerUrlError::Malformed));
    }
}

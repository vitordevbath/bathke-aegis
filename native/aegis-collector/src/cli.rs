//! Command-line interface. Codes and credentials are never accepted as
//! arguments: they would end up in the shell history and in the process list.

pub const USAGE: &str = "\
Aegis Collector — agente explícito para hosts Linux autorizados

Uso:
  aegis-collector pair --server <URL>   pareia este host com um código gerado no painel (pedido sem eco)
  aegis-collector run [--once] [-v]     executa em primeiro plano: heartbeat, eventos SYSTEM e fila local
  aegis-collector status                mostra pareamento, arquivos e fila (nunca a credencial)
  aegis-collector replace-credential    instala a credencial exibida no painel após uma rotação
  aegis-collector unpair [--yes]        remove a configuração local (não revoga no servidor)
  aegis-collector --version | --help

URL: https://… ou, somente em loopback, http://localhost:8080.
O código de pareamento e a credencial são lidos do terminal (ou da entrada padrão), nunca de argumentos.";

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Version,
    Help,
    Pair { server: String },
    Status,
    Run { once: bool, verbose: bool },
    Unpair { yes: bool },
    ReplaceCredential,
}

const SECRET_FLAGS: [&str; 6] = ["--code", "--token", "--credential", "--secret", "--password", "--key"];

pub fn parse(args: &[String]) -> Result<Command, String> {
    if let Some(flag) = SECRET_FLAGS.iter().find(|f| args.iter().any(|a| a.as_str() == **f || a.starts_with(&format!("{f}=")))) {
        // Only the flag's name is echoed, never what followed it.
        return Err(format!("{flag} não é aceito: por segurança, códigos e credenciais são lidos do terminal, nunca de argumentos"));
    }
    let mut iter = args.iter().map(String::as_str);
    let command = iter.next();
    let rest: Vec<&str> = iter.collect();
    let unexpected = |extra: &[&str]| -> Result<(), String> {
        match extra.first() {
            Some(arg) => Err(format!("argumento inesperado: {arg}")),
            None => Ok(()),
        }
    };
    match command {
        None | Some("-h" | "--help" | "help") => unexpected(&rest).map(|_| Command::Help),
        Some("-V" | "--version" | "version") => unexpected(&rest).map(|_| Command::Version),
        Some("pair") => {
            let server = match rest.as_slice() {
                ["--server", url] => url.to_string(),
                [arg] if arg.starts_with("--server=") => arg["--server=".len()..].to_string(),
                [] => return Err("informe o servidor: aegis-collector pair --server <URL>".into()),
                other => return Err(format!("argumentos inválidos para pair: {}", other.join(" "))),
            };
            Ok(Command::Pair { server })
        }
        Some("status") => unexpected(&rest).map(|_| Command::Status),
        Some("run") => {
            let (mut once, mut verbose) = (false, false);
            for arg in rest {
                match arg {
                    "--once" => once = true,
                    "-v" | "--verbose" => verbose = true,
                    other => return Err(format!("argumento inesperado: {other}")),
                }
            }
            Ok(Command::Run { once, verbose })
        }
        Some("unpair") => match rest.as_slice() {
            [] => Ok(Command::Unpair { yes: false }),
            ["--yes"] => Ok(Command::Unpair { yes: true }),
            other => Err(format!("argumentos inválidos para unpair: {}", other.join(" "))),
        },
        Some("replace-credential") => unexpected(&rest).map(|_| Command::ReplaceCredential),
        Some(other) => Err(format!("comando desconhecido: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn parses_the_commands() {
        assert_eq!(parse(&args("--version")), Ok(Command::Version));
        assert_eq!(parse(&args("")), Ok(Command::Help));
        assert_eq!(parse(&args("pair --server http://localhost:8080")), Ok(Command::Pair { server: "http://localhost:8080".into() }));
        assert_eq!(parse(&args("pair --server=https://a.example")), Ok(Command::Pair { server: "https://a.example".into() }));
        assert_eq!(parse(&args("status")), Ok(Command::Status));
        assert_eq!(parse(&args("run")), Ok(Command::Run { once: false, verbose: false }));
        assert_eq!(parse(&args("run --once -v")), Ok(Command::Run { once: true, verbose: true }));
        assert_eq!(parse(&args("unpair --yes")), Ok(Command::Unpair { yes: true }));
        assert_eq!(parse(&args("replace-credential")), Ok(Command::ReplaceCredential));
    }

    #[test]
    fn never_accepts_secrets_as_arguments() {
        for line in ["pair --server http://localhost:8080 --code aegis_pair_x", "replace-credential --token=aegis_agent_x", "run --secret x"] {
            let error = parse(&args(line)).unwrap_err();
            assert!(error.contains("nunca de argumentos"), "{error}");
            assert!(!error.contains("aegis_pair_x") && !error.contains("aegis_agent_x"));
        }
    }

    #[test]
    fn refuses_unknown_input() {
        assert!(parse(&args("pair")).is_err());
        assert!(parse(&args("status --all")).is_err());
        assert!(parse(&args("run --forever")).is_err());
        assert!(parse(&args("install")).is_err());
    }
}

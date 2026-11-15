use std::io::{self, BufRead, IsTerminal, Read, Write};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};

use aegis_collector::cli::{self, Command, USAGE};
use aegis_collector::commands::{self, UnpairOutcome};
use aegis_collector::config::Secret;
use aegis_collector::delivery::Fatal;
use aegis_collector::logger::{Level, Logger};
use aegis_collector::paths::Paths;
use aegis_collector::run::{RunExit, RunOptions, run};

/// Exit codes: 0 ok · 1 error · 2 usage · 3 credential refused (401) · 4 not allowed / wrong host (403/404).
const EXIT_ERROR: u8 = 1;
const EXIT_USAGE: u8 = 2;
const EXIT_CREDENTIAL_REFUSED: u8 = 3;
const EXIT_NOT_ALLOWED: u8 = 4;

static SHUTDOWN: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    // Only an atomic store: async-signal-safe.
    SHUTDOWN.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    for signal in [libc::SIGINT, libc::SIGTERM] {
        // SAFETY: a zeroed sigaction with a valid handler pointer and an empty mask is a valid argument.
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = on_signal as *const () as usize;
            libc::sigemptyset(&mut action.sa_mask);
            libc::sigaction(signal, &action, std::ptr::null_mut());
        }
    }
}

/// Reads a secret without echo from the terminal, or one line from standard input when it is not a terminal.
fn read_secret(prompt: &str) -> Result<Secret, String> {
    let value = if io::stdin().is_terminal() {
        rpassword::prompt_password(prompt).map_err(|_| "não foi possível ler do terminal".to_string())?
    } else {
        let mut line = String::new();
        io::stdin().lock().take(1024).read_line(&mut line).map_err(|_| "não foi possível ler a entrada padrão".to_string())?;
        line
    };
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err("nenhum valor informado".into());
    }
    Ok(Secret::new(value))
}

fn confirm(question: &str, expected: &str) -> bool {
    if !io::stdin().is_terminal() {
        return false;
    }
    print!("{question} ");
    let _ = io::stdout().flush();
    let mut answer = String::new();
    io::stdin().lock().read_line(&mut answer).is_ok() && answer.trim() == expected
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match cli::parse(&args) {
        Ok(command) => command,
        Err(message) => {
            eprintln!("erro: {message}\n\n{USAGE}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let paths = match Paths::from_environment() {
        Ok(paths) => paths,
        Err(message) => {
            eprintln!("erro: {message}");
            return ExitCode::from(EXIT_ERROR);
        }
    };
    let result: Result<ExitCode, String> = match command {
        Command::Help => {
            println!("{USAGE}");
            Ok(ExitCode::SUCCESS)
        }
        Command::Version => {
            println!("aegis-collector {}", aegis_collector::VERSION);
            Ok(ExitCode::SUCCESS)
        }
        Command::Pair { server } => read_secret("Código de pareamento (não será exibido): ").and_then(|code| {
            let config = commands::pair(&paths, &server, &code).map_err(|e| e.to_string())?;
            println!("Host pareado com sucesso.");
            println!("  Servidor:   {}", config.server);
            println!("  Workspace:  {}", config.workspace_id);
            println!("  Host:       {}", config.host_id);
            println!("  Credencial: {} (armazenada em {}, permissões 0600)", config.credential_label(), paths.config_file().display());
            println!("  Escopos:    {}", config.scopes.join(", "));
            println!("Próximo passo: aegis-collector run");
            Ok(ExitCode::SUCCESS)
        }),
        Command::ReplaceCredential => read_secret("Nova credencial de máquina exibida no painel (não será exibida): ").and_then(|token| {
            let config = commands::replace_credential(&paths, &token).map_err(|e| e.to_string())?;
            println!("Credencial substituída e verificada com o servidor: {} ({}).", config.credential_label(), config.scopes.join(", "));
            Ok(ExitCode::SUCCESS)
        }),
        Command::Status => commands::status(&paths)
            .map(|report| {
                println!("{report}");
                ExitCode::SUCCESS
            })
            .map_err(|e| e.to_string()),
        Command::Unpair { yes } => {
            if !yes
                && !confirm(
                    "Remover a configuração local deste Collector? A credencial NÃO será revogada no servidor. Digite 'desparear' para confirmar:",
                    "desparear",
                )
            {
                Err("operação não confirmada; nada foi removido (use --yes em uso não interativo)".into())
            } else {
                commands::unpair(&paths).map_err(|e| e.to_string()).map(|outcome| {
                    match outcome {
                        UnpairOutcome::NothingToRemove => println!("Nenhuma configuração local para remover."),
                        UnpairOutcome::Removed { host_id, pending, spool } => {
                            println!("Configuração local removida (host {host_id}).");
                            println!("A credencial continua válida no servidor até ser revogada no painel (Hosts → host → Pareamento do Collector).");
                            println!(
                                "Fila local preservada em {} ({pending} evento(s) pendente(s)); ela só é usada se este mesmo host for pareado de novo.",
                                spool.display()
                            );
                        }
                    }
                    ExitCode::SUCCESS
                })
            }
        }
        Command::Run { once, verbose } => {
            install_signal_handlers();
            let log = Logger::stderr(if verbose { Level::Debug } else { Level::Info });
            let options = RunOptions { once, ..RunOptions::default() };
            run(&paths, &options, &log, &SHUTDOWN).map(|exit| match exit {
                RunExit::Stopped | RunExit::Completed => ExitCode::SUCCESS,
                RunExit::Fatal(Fatal::CredentialRejected) => ExitCode::from(EXIT_CREDENTIAL_REFUSED),
                RunExit::Fatal(Fatal::Forbidden | Fatal::HostMismatch) => ExitCode::from(EXIT_NOT_ALLOWED),
            })
        }
    };
    result.unwrap_or_else(|message| {
        eprintln!("erro: {message}");
        ExitCode::from(EXIT_ERROR)
    })
}

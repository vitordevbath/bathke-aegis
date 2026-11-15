//! Line-oriented log for the operator, on standard error. Only messages built
//! by the Collector reach it: response bodies, request headers and secrets are
//! never passed in, so there is nothing to redact.

use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::time::rfc3339_utc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

#[derive(Clone)]
pub struct Logger {
    sink: Arc<Mutex<Box<dyn Write + Send>>>,
    min: Level,
}

impl Logger {
    pub fn stderr(min: Level) -> Self {
        Self::to(Box::new(io::stderr()), min)
    }

    pub fn to(sink: Box<dyn Write + Send>, min: Level) -> Self {
        Self { sink: Arc::new(Mutex::new(sink)), min }
    }

    pub fn log(&self, level: Level, message: &str) {
        if level < self.min {
            return;
        }
        let line = format!("{} {:<5} {}\n", rfc3339_utc(SystemTime::now()), level.label(), message.replace(['\n', '\r'], " "));
        if let Ok(mut sink) = self.sink.lock() {
            let _ = sink.write_all(line.as_bytes());
            let _ = sink.flush();
        }
    }

    pub fn debug(&self, message: &str) {
        self.log(Level::Debug, message);
    }
    pub fn info(&self, message: &str) {
        self.log(Level::Info, message);
    }
    pub fn warn(&self, message: &str) {
        self.log(Level::Warn, message);
    }
    pub fn error(&self, message: &str) {
        self.log(Level::Error, message);
    }
}

/// An in-memory sink for tests: everything the Collector logged, as text.
#[derive(Clone, Default)]
pub struct CapturedLog(Arc<Mutex<Vec<u8>>>);

impl CapturedLog {
    pub fn logger(&self) -> Logger {
        Logger::to(Box::new(self.clone()), Level::Debug)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().map(|b| b.clone()).unwrap_or_default()).into_owned()
    }
}

impl Write for CapturedLog {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Ok(mut inner) = self.0.lock() {
            inner.extend_from_slice(buf);
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_line_per_message_with_time_and_level() {
        let captured = CapturedLog::default();
        let logger = captured.logger();
        logger.info("linha\ncom quebra");
        logger.debug("detalhe");
        let text = captured.text();
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("INFO  linha com quebra"));
        assert!(text.lines().next().unwrap().ends_with("linha com quebra"));
    }

    #[test]
    fn respects_the_minimum_level() {
        let captured = CapturedLog::default();
        let logger = Logger::to(Box::new(captured.clone()), Level::Warn);
        logger.info("oculto");
        logger.warn("visível");
        assert_eq!(captured.text().lines().count(), 1);
    }
}

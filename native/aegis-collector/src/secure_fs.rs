//! Private files for the credential and the local queue. Protection comes from
//! file-system ownership and permissions only: directories `0700`, files
//! `0600`, owned by the current user, never reached through a symbolic link.
//! That keeps other unprivileged local users out; it does not protect against
//! root or against code running as the same user. Nothing here encrypts.

use std::fmt;
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// Largest private file read back (the configuration is a few hundred bytes).
pub const MAX_PRIVATE_FILE_BYTES: u64 = 64 * 1024;

#[derive(Debug)]
pub enum SecureFsError {
    Io(PathBuf, io::Error),
    Symlink(PathBuf),
    NotADirectory(PathBuf),
    NotARegularFile(PathBuf),
    WrongOwner(PathBuf),
    TooOpen(PathBuf, u32),
    TooLarge(PathBuf),
    AlreadyExists(PathBuf),
}

impl fmt::Display for SecureFsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(path, error) => write!(f, "{}: {error}", path.display()),
            Self::Symlink(path) => write!(f, "{} é um link simbólico; por segurança ele não é seguido", path.display()),
            Self::NotADirectory(path) => write!(f, "{} não é um diretório", path.display()),
            Self::NotARegularFile(path) => write!(f, "{} não é um arquivo comum", path.display()),
            Self::WrongOwner(path) => write!(f, "{} pertence a outro usuário", path.display()),
            Self::TooOpen(path, mode) => write!(
                f,
                "{} tem permissões {:o}, abertas demais para dados do Collector; corrija com chmod {} {}",
                path.display(),
                mode & 0o777,
                if path.is_dir() { "700" } else { "600" },
                path.display()
            ),
            Self::TooLarge(path) => write!(f, "{} é grande demais para ser um arquivo do Collector", path.display()),
            Self::AlreadyExists(path) => write!(f, "{} já existe e não será sobrescrito", path.display()),
        }
    }
}

impl std::error::Error for SecureFsError {}

fn current_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

/// Checks owner and mode of an existing entry reached without following links.
fn check_private(path: &Path, metadata: &fs::Metadata, want_dir: bool) -> Result<(), SecureFsError> {
    if metadata.file_type().is_symlink() {
        return Err(SecureFsError::Symlink(path.to_path_buf()));
    }
    if want_dir && !metadata.is_dir() {
        return Err(SecureFsError::NotADirectory(path.to_path_buf()));
    }
    if !want_dir && !metadata.is_file() {
        return Err(SecureFsError::NotARegularFile(path.to_path_buf()));
    }
    if metadata.uid() != current_uid() {
        return Err(SecureFsError::WrongOwner(path.to_path_buf()));
    }
    if metadata.mode() & 0o077 != 0 {
        return Err(SecureFsError::TooOpen(path.to_path_buf(), metadata.mode()));
    }
    Ok(())
}

/// Creates `dir` (and missing parents) with mode `0700`, or validates an existing
/// one: a real directory, owned by this user, not accessible to anyone else.
pub fn ensure_private_dir(dir: &Path) -> Result<(), SecureFsError> {
    match fs::symlink_metadata(dir) {
        Ok(metadata) => check_private(dir, &metadata, true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|e| SecureFsError::Io(dir.to_path_buf(), e))?;
            // `recursive` applies the mode to every directory it creates, but an umask could remove bits only;
            // set it explicitly on the leaf so the result never depends on the environment.
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| SecureFsError::Io(dir.to_path_buf(), e))?;
            let metadata = fs::symlink_metadata(dir).map_err(|e| SecureFsError::Io(dir.to_path_buf(), e))?;
            check_private(dir, &metadata, true)
        }
        Err(error) => Err(SecureFsError::Io(dir.to_path_buf(), error)),
    }
}

/// Opens an existing private file for reading without following links, then
/// validates what was actually opened (no race between check and use).
pub fn read_private_file(path: &Path) -> Result<Option<Vec<u8>>, SecureFsError> {
    let file = match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) if error.raw_os_error() == Some(libc::ELOOP) => return Err(SecureFsError::Symlink(path.to_path_buf())),
        Err(error) => return Err(SecureFsError::Io(path.to_path_buf(), error)),
    };
    let metadata = file.metadata().map_err(|e| SecureFsError::Io(path.to_path_buf(), e))?;
    check_private(path, &metadata, false)?;
    if metadata.len() > MAX_PRIVATE_FILE_BYTES {
        return Err(SecureFsError::TooLarge(path.to_path_buf()));
    }
    let mut contents = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_PRIVATE_FILE_BYTES + 1).read_to_end(&mut contents).map_err(|e| SecureFsError::Io(path.to_path_buf(), e))?;
    Ok(Some(contents))
}

/// Writes a new private file atomically: a temporary file created with
/// `O_EXCL | O_NOFOLLOW` and mode `0600`, synced, then hard-linked into place.
/// `link` fails if the target exists, so an existing file is never replaced.
pub fn create_private_file(path: &Path, contents: &[u8]) -> Result<(), SecureFsError> {
    let dir = path.parent().ok_or_else(|| SecureFsError::NotARegularFile(path.to_path_buf()))?;
    ensure_private_dir(dir)?;
    if fs::symlink_metadata(path).is_ok() {
        return Err(SecureFsError::AlreadyExists(path.to_path_buf()));
    }
    let temporary = dir.join(format!(".{}.{}.tmp", path.file_name().and_then(|n| n.to_str()).unwrap_or("arquivo"), std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&temporary)
            .map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        file.write_all(contents).map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        file.sync_all().map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        fs::hard_link(&temporary, path).map_err(|e| match e.kind() {
            io::ErrorKind::AlreadyExists => SecureFsError::AlreadyExists(path.to_path_buf()),
            _ => SecureFsError::Io(path.to_path_buf(), e),
        })?;
        File::open(dir).and_then(|d| d.sync_all()).map_err(|e| SecureFsError::Io(dir.to_path_buf(), e))
    })();
    let _ = fs::remove_file(&temporary);
    result
}

/// Replaces an existing private file atomically (explicit operator action):
/// the current file must be a private regular file, and the new content goes
/// through a `0600` temporary file that is synced and renamed over it.
pub fn replace_private_file(path: &Path, contents: &[u8]) -> Result<(), SecureFsError> {
    if read_private_file(path)?.is_none() {
        return Err(SecureFsError::Io(path.to_path_buf(), io::Error::from(io::ErrorKind::NotFound)));
    }
    let dir = path.parent().ok_or_else(|| SecureFsError::NotARegularFile(path.to_path_buf()))?;
    ensure_private_dir(dir)?;
    let temporary = dir.join(format!(".{}.{}.new", path.file_name().and_then(|n| n.to_str()).unwrap_or("arquivo"), std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&temporary)
            .map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        file.write_all(contents).map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        file.sync_all().map_err(|e| SecureFsError::Io(temporary.clone(), e))?;
        fs::rename(&temporary, path).map_err(|e| SecureFsError::Io(path.to_path_buf(), e))?;
        File::open(dir).and_then(|d| d.sync_all()).map_err(|e| SecureFsError::Io(dir.to_path_buf(), e))
    })();
    let _ = fs::remove_file(&temporary);
    result
}

/// Creates an empty private file if missing (`0600`, no links followed), or validates the existing one.
pub fn ensure_private_file(path: &Path) -> Result<(), SecureFsError> {
    match OpenOptions::new().read(true).write(true).create(true).mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(path) {
        Ok(file) => {
            let metadata = file.metadata().map_err(|e| SecureFsError::Io(path.to_path_buf(), e))?;
            check_private(path, &metadata, false)
        }
        Err(error) if error.raw_os_error() == Some(libc::ELOOP) => Err(SecureFsError::Symlink(path.to_path_buf())),
        Err(error) => Err(SecureFsError::Io(path.to_path_buf(), error)),
    }
}

/// Removes a private file if present; a link or directory in its place is refused.
pub fn remove_private_file(path: &Path) -> Result<bool, SecureFsError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(SecureFsError::Symlink(path.to_path_buf())),
        Ok(metadata) if !metadata.is_file() => Err(SecureFsError::NotARegularFile(path.to_path_buf())),
        Ok(_) => fs::remove_file(path).map(|_| true).map_err(|e| SecureFsError::Io(path.to_path_buf(), e)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(SecureFsError::Io(path.to_path_buf(), error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn mode_of(path: &Path) -> u32 {
        fs::symlink_metadata(path).unwrap().mode() & 0o777
    }

    #[test]
    fn creates_directories_0700_and_files_0600() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("a/b/aegis");
        ensure_private_dir(&dir).unwrap();
        assert_eq!(mode_of(&dir), 0o700);
        let file = dir.join("config.json");
        create_private_file(&file, b"{}").unwrap();
        assert_eq!(mode_of(&file), 0o600);
        assert_eq!(read_private_file(&file).unwrap().unwrap(), b"{}");
        // No temporary file is left behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn never_overwrites_an_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("aegis");
        let file = dir.join("config.json");
        create_private_file(&file, b"first").unwrap();
        assert!(matches!(create_private_file(&file, b"second"), Err(SecureFsError::AlreadyExists(_))));
        assert_eq!(read_private_file(&file).unwrap().unwrap(), b"first");
    }

    #[test]
    fn refuses_permissions_open_to_others() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("aegis");
        ensure_private_dir(&dir).unwrap();
        let file = dir.join("config.json");
        create_private_file(&file, b"{}").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(matches!(read_private_file(&file), Err(SecureFsError::TooOpen(_, _))));
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(ensure_private_dir(&dir), Err(SecureFsError::TooOpen(_, _))));
        let message = ensure_private_dir(&dir).unwrap_err().to_string();
        assert!(message.contains("chmod 700"), "{message}");
    }

    #[test]
    fn never_follows_symbolic_links() {
        let root = tempfile::tempdir().unwrap();
        let real_dir = root.path().join("real");
        ensure_private_dir(&real_dir).unwrap();
        let target = real_dir.join("target.json");
        create_private_file(&target, b"{}").unwrap();

        let linked_file = real_dir.join("config.json");
        symlink(&target, &linked_file).unwrap();
        assert!(matches!(read_private_file(&linked_file), Err(SecureFsError::Symlink(_))));
        assert!(matches!(create_private_file(&linked_file, b"x"), Err(SecureFsError::AlreadyExists(_))));
        assert!(matches!(ensure_private_file(&linked_file), Err(SecureFsError::Symlink(_))));
        assert!(matches!(remove_private_file(&linked_file), Err(SecureFsError::Symlink(_))));
        assert_eq!(read_private_file(&target).unwrap().unwrap(), b"{}");

        let linked_dir = root.path().join("linked");
        symlink(&real_dir, &linked_dir).unwrap();
        assert!(matches!(ensure_private_dir(&linked_dir), Err(SecureFsError::Symlink(_))));
    }

    #[test]
    fn replaces_only_an_existing_private_file() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("aegis/config.json");
        assert!(replace_private_file(&file, b"x").is_err());
        create_private_file(&file, b"old").unwrap();
        replace_private_file(&file, b"new").unwrap();
        assert_eq!(read_private_file(&file).unwrap().unwrap(), b"new");
        assert_eq!(mode_of(&file), 0o600);
    }

    #[test]
    fn missing_files_are_reported_as_absent() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_private_file(&root.path().join("nada.json")).unwrap().is_none());
        assert!(!remove_private_file(&root.path().join("nada.json")).unwrap());
    }
}

//! One user-scoped DPAPI envelope per local pig profile. No load-or-generate fallback.
use anyhow::{Context, Result, ensure};
use iroh_base::SecretKey;
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    ptr::{null, null_mut},
    slice,
};
use tempfile::NamedTempFile;
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};
use zeroize::{Zeroize, Zeroizing};

const FILE: &str = "pairing-identity.dpapi";
const MAX_ENVELOPE: usize = 16 * 1024;

fn dpapi(input: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>> {
    let blob = CRYPT_INTEGER_BLOB {
        cbData: input.len().try_into()?,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut out = CRYPT_INTEGER_BLOB::default();
    // DPAPI only reads the input. No machine scope, prompt, optional entropy or description.
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &blob,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        } else {
            CryptUnprotectData(
                &blob,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        }
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error()).context("Windows DPAPI failed");
    }
    ensure!(!out.pbData.is_null(), "DPAPI returned no data");
    // On success Windows owns this LocalAlloc buffer until the caller frees it.
    let bytes = unsafe { slice::from_raw_parts_mut(out.pbData, out.cbData as usize) };
    let result = Zeroizing::new(bytes.to_vec());
    bytes.zeroize();
    unsafe { LocalFree(out.pbData.cast()) };
    Ok(result)
}

/// Explicit first-time enrollment only. Never replaces an existing or damaged identity.
pub fn create(profile: &Path) -> Result<SecretKey> {
    let key = SecretKey::generate();
    let seed = Zeroizing::new(key.to_bytes());
    let encrypted = dpapi(seed.as_ref(), true)?;
    let mut tmp = NamedTempFile::new_in(profile)?;
    tmp.write_all(&encrypted)?;
    tmp.as_file().sync_all()?;
    tmp.persist_noclobber(profile.join(FILE))
        .context("could not install new pairing identity")?;
    Ok(key)
}

/// Does not write, even if the key is missing, malformed, or belongs to another user.
pub fn load(profile: &Path) -> Result<SecretKey> {
    let mut encrypted = Vec::new();
    File::open(profile.join(FILE))?
        .take(MAX_ENVELOPE as u64 + 1)
        .read_to_end(&mut encrypted)?;
    ensure!(
        !encrypted.is_empty() && encrypted.len() <= MAX_ENVELOPE,
        "invalid pairing identity file"
    );
    let seed = dpapi(&encrypted, false)?;
    Ok(SecretKey::from_bytes(
        seed.as_slice()
            .try_into()
            .context("invalid pairing key length")?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_fails_closed_and_create_never_overwrites() -> Result<()> {
        let profile = tempfile::tempdir()?;
        let dir = profile.path();
        let file = dir.join(FILE);
        assert!(load(dir).is_err());
        assert!(!file.exists());
        let key = create(dir)?;
        let sealed = std::fs::read(&file)?;
        assert!(!sealed.windows(32).any(|w| w == key.to_bytes()));
        assert!(create(dir).is_err());
        assert_eq!(load(dir)?.public(), key.public());
        let mut corrupt = sealed;
        *corrupt.last_mut().unwrap() ^= 1;
        std::fs::write(&file, &corrupt)?;
        assert!(load(dir).is_err());
        assert!(create(dir).is_err());
        assert_eq!(std::fs::read(file)?, corrupt);
        Ok(())
    }
}

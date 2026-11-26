//! Host-side pairing policy. No listener, renderer RPCs, or global profile access.
#[cfg(windows)]
pub mod identity;

use anyhow::{Result, ensure};
use iroh_base::EndpointId;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::{path::Path, str::FromStr};

const PREFIX: &str = "pig-pair:1:";
pub const INVITE_LEN: usize = PREFIX.len() + 64 + 1 + 64;
const TTL_SECONDS: i64 = 12 * 60 * 60;

// No Debug or Display: accidental logging must not print a bearer credential.
pub struct Invite {
    pub host: EndpointId,
    secret: [u8; 32],
}

impl Invite {
    /// Sensitive. Transfer privately; the first authenticated peer presenting it wins.
    pub fn for_copy(&self) -> String {
        format!(
            "{PREFIX}{}:{}",
            hex::encode(self.host.as_bytes()),
            hex::encode(self.secret)
        )
    }
}

impl FromStr for Invite {
    type Err = anyhow::Error;

    fn from_str(text: &str) -> Result<Self> {
        ensure!(text.len() == INVITE_LEN, "invalid invite");
        let (host, token) = text
            .strip_prefix(PREFIX)
            .and_then(|s| s.split_once(':'))
            .ok_or_else(|| anyhow::anyhow!("invalid invite"))?;
        let mut key = [0; 32];
        let mut secret = [0; 32];
        hex::decode_to_slice(host, &mut key)?;
        hex::decode_to_slice(token, &mut secret)?;
        Ok(Self {
            host: EndpointId::from_bytes(&key)?,
            secret,
        })
    }
}

pub struct PairingStore {
    db: Connection,
    host: EndpointId,
}

impl PairingStore {
    /// Use a dedicated DB in the local profile. The host ID comes from our endpoint.
    pub fn open(file: &Path, host: EndpointId) -> Result<Self> {
        let db = Connection::open(file)?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS invite(
            host BLOB PRIMARY KEY NOT NULL, digest BLOB NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS device(host BLOB NOT NULL, peer BLOB NOT NULL,
            PRIMARY KEY(host, peer));",
        )?;
        Ok(Self { db, host })
    }

    /// Host-local action only. Issuing a new invite invalidates the previous one.
    pub fn issue(&self) -> Result<Invite> {
        let mut secret = [0; 32];
        getrandom::fill(&mut secret)?;
        let digest = Sha256::digest(secret);
        self.db.execute(
            "INSERT OR REPLACE INTO invite VALUES (?1, ?2, unixepoch()+?3)",
            params![self.host.as_bytes(), &digest[..], TTL_SECONDS],
        )?;
        Ok(Invite {
            host: self.host,
            secret,
        })
    }

    pub fn cancel_invite(&self) -> Result<()> {
        self.db
            .execute("DELETE FROM invite WHERE host=?1", [self.host.as_bytes()])?;
        Ok(())
    }

    /// Caller must use iroh's completed connection.remote_id(), never a packet field.
    pub fn redeem(&mut self, invite: &Invite, authenticated_peer: EndpointId) -> Result<bool> {
        if self.host != invite.host || authenticated_peer == self.host {
            return Ok(false);
        }
        let digest = Sha256::digest(invite.secret);
        let tx = self.db.transaction()?;
        if tx.execute(
            "DELETE FROM invite WHERE host=?1 AND digest=?2 AND expires>unixepoch()",
            params![self.host.as_bytes(), &digest[..]],
        )? == 0
        {
            return Ok(false);
        }
        tx.execute(
            "INSERT OR IGNORE INTO device VALUES (?1, ?2)",
            params![self.host.as_bytes(), authenticated_peer.as_bytes()],
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn is_paired(&self, peer: EndpointId) -> Result<bool> {
        Ok(self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM device WHERE host=?1 AND peer=?2)",
            params![self.host.as_bytes(), peer.as_bytes()],
            |r| r.get(0),
        )?)
    }

    /// Persist the revocation before closing this peer's live connections.
    pub fn revoke(&self, peer: EndpointId) -> Result<()> {
        self.db.execute(
            "DELETE FROM device WHERE host=?1 AND peer=?2",
            params![self.host.as_bytes(), peer.as_bytes()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh_base::SecretKey;
    use std::{
        sync::{Arc, Barrier},
        thread,
    };

    fn id() -> EndpointId {
        SecretKey::generate().public()
    }

    #[test]
    fn expiry_rotation_cancel_and_wrong_host() -> Result<()> {
        let host = id();
        let peer = id();
        let mut s = PairingStore::open(Path::new(":memory:"), host)?;
        let old = s.issue()?;
        let current = s.issue()?;
        assert!(!s.redeem(&old, peer)?);
        let mut fake = current.for_copy().parse::<Invite>()?;
        fake.host = peer;
        assert!(!s.redeem(&fake, peer)?);
        fake.host = host;
        fake.secret[0] ^= 1;
        assert!(!s.redeem(&fake, peer)?);
        assert!(
            current
                .for_copy()
                .replace("pig-pair:1", "pig-pair:2")
                .parse::<Invite>()
                .is_err()
        );
        assert!(current.for_copy()[1..].parse::<Invite>().is_err());
        s.db.execute("UPDATE invite SET expires=unixepoch()", [])?;
        assert!(!s.redeem(&current, peer)?);
        let cancelled = s.issue()?;
        s.cancel_invite()?;
        assert!(!s.redeem(&cancelled, peer)?);
        assert!(!s.is_paired(peer)?);
        Ok(())
    }

    #[test]
    fn exactly_one_winner_across_connections_then_persistent_revocation() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let file = dir.path().join("pairing.sqlite");
        let host = id();
        let token = PairingStore::open(&file, host)?.issue()?.for_copy();
        let barrier = Arc::new(Barrier::new(2));
        let jobs = [id(), id()].map(|peer| -> Result<_> {
            let mut store = PairingStore::open(&file, host)?;
            let invite = token.parse()?;
            let barrier = barrier.clone();
            Ok(thread::spawn(move || -> Result<_> {
                barrier.wait();
                Ok((peer, store.redeem(&invite, peer)?))
            }))
        });
        let mut store = PairingStore::open(&file, host)?;
        let mut count = 0;
        for job in jobs {
            let (peer, won) = job?.join().unwrap()?;
            assert_eq!(store.is_paired(peer)?, won);
            count += usize::from(won);
            store.revoke(peer)?;
            assert!(!PairingStore::open(&file, host)?.is_paired(peer)?);
            assert!(!store.redeem(&token.parse()?, peer)?);
        }
        assert_eq!(count, 1);
        Ok(())
    }
}

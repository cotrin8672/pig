use std::{net::Ipv4Addr, time::Duration};

use anyhow::{Context, Result, ensure};
use iroh::{
    Endpoint, EndpointAddr, RelayMode, RelayUrl,
    endpoint::{Connection, presets},
};
use iroh_relay::server::{RelayConfig, Server, ServerConfig};
use pig_pairing::{INVITE_LEN, Invite, PairingStore};
use std::path::Path;
use tokio::time::timeout;

const ALPN: &[u8] = b"pig/pairing-probe/1";

async fn endpoint(relay: Option<&RelayUrl>) -> Result<Endpoint> {
    endpoint_with_key(relay, iroh::SecretKey::generate()).await
}

async fn endpoint_with_key(relay: Option<&RelayUrl>, key: iroh::SecretKey) -> Result<Endpoint> {
    let builder = Endpoint::builder(presets::Minimal)
        .secret_key(key)
        .alpns(vec![ALPN.to_vec()])
        .clear_ip_transports()
        .clear_address_lookup();
    let ep = match relay {
        Some(url) => builder.relay_mode(RelayMode::custom([url.clone()])),
        None => builder
            .relay_mode(RelayMode::Disabled)
            .bind_addr((Ipv4Addr::LOCALHOST, 0))?,
    }
    .bind()
    .await?;
    ensure!(ep.bound_sockets().iter().all(|a| a.ip().is_loopback()));
    if relay.is_some() {
        ensure!(ep.bound_sockets().is_empty());
        ep.online().await;
    }
    Ok(ep)
}

async fn dial(
    host: &Endpoint,
    dst: EndpointAddr,
    client: &Endpoint,
) -> Result<(Connection, Connection)> {
    let (incoming, outgoing) = tokio::join!(
        async {
            host.accept()
                .await
                .context("host stopped")?
                .await
                .map_err(anyhow::Error::from)
        },
        client.connect(dst, ALPN),
    );
    let (incoming, outgoing) = (incoming?, outgoing?);
    ensure!(outgoing.remote_id() == host.id());
    Ok((incoming, outgoing))
}

fn authorize(connection: &Connection, store: &PairingStore) -> Result<bool> {
    if store.is_paired(connection.remote_id())? {
        return Ok(true);
    }
    connection.close(1u8.into(), b"not paired");
    Ok(false)
}

async fn expect_close(client: &Connection, reason: &[u8]) -> Result<()> {
    match client.closed().await {
        iroh::endpoint::ConnectionError::ApplicationClosed(e) if e.reason.as_ref() == reason => {
            Ok(())
        }
        other => anyhow::bail!("unexpected close: {other}"),
    }
}

async fn probe(relay: Option<&RelayUrl>) -> Result<()> {
    let host = endpoint(relay).await?;
    let laptop = endpoint(relay).await?;
    let other = endpoint(relay).await?;
    let route = if relay.is_some() {
        "relay-only"
    } else {
        "loopback IP"
    };
    let dst = match relay {
        Some(url) => EndpointAddr::new(host.id()).with_relay_url(url.clone()),
        None => EndpointAddr::new(host.id()).with_ip_addr(host.bound_sockets()[0]),
    };
    let mut store = PairingStore::open(Path::new(":memory:"), host.id())?;
    let copied = store.issue()?.for_copy();
    let (server, client) = dial(&host, dst.clone(), &other).await?;
    ensure!(!authorize(&server, &store)?);
    expect_close(&client, b"not paired").await?;

    let invite: Invite = copied.parse()?;
    let (server, client) = dial(&host, dst.clone(), &laptop).await?;
    ensure!(client.remote_id() == invite.host);
    let mut submit = client.open_uni().await?;
    submit.write_all(copied.as_bytes()).await?;
    submit.finish()?;
    let bytes = server.accept_uni().await?.read_to_end(INVITE_LEN).await?;
    ensure!(store.redeem(&std::str::from_utf8(&bytes)?.parse()?, server.remote_id())?);
    ensure!(authorize(&server, &store)?);
    let (mut send, mut recv) = client.open_bi().await?;
    send.write_all(b"snapshot").await?;
    send.finish()?;
    let (mut reply, mut query) = server.accept_bi().await?;
    ensure!(query.read_to_end(64).await? == b"snapshot");
    reply.write_all(b"fixture:42").await?;
    reply.finish()?;
    ensure!(recv.read_to_end(64).await? == b"fixture:42");
    let mut paths = client.paths_stream();
    paths
        .wait_any(|p| {
            if relay.is_some() {
                p.is_relay()
            } else {
                p.is_ip()
            }
        })
        .await
        .context("path stream ended")?;

    store.revoke(laptop.id())?;
    server.close(2u8.into(), b"revoked");
    expect_close(&client, b"revoked").await?;
    let (server, client) = dial(&host, dst, &laptop).await?;
    ensure!(!authorize(&server, &store)?);
    expect_close(&client, b"not paired").await?;
    tokio::join!(host.close(), laptop.close(), other.close());
    println!(
        "PASS {route}: unknown denied, snapshot round trip, revocation observed, reconnect denied"
    );
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--public-relay"] {
        let url = iroh::defaults::prod::default_ap_relay().url;
        println!("Public relay only: {url}");
        return timeout(Duration::from_secs(60), probe(Some(&url)))
            .await
            .context("public relay timeout")?;
    }
    ensure!(args.is_empty(), "usage: pig-pairing-probe [--public-relay]");
    timeout(Duration::from_secs(30), probe(None))
        .await
        .context("direct timeout")??;
    // Outer relay HTTP is local only; peer identity and inner QUIC encryption stay enabled.
    let mut config = ServerConfig::default();
    config.relay = Some(RelayConfig::new((Ipv4Addr::LOCALHOST, 0)));
    let relay = Server::spawn(config).await?;
    let addr = relay.http_addr().context("missing local relay")?;
    ensure!(addr.ip().is_loopback());
    let url = format!("http://{addr}").parse()?;
    let result = timeout(Duration::from_secs(30), probe(Some(&url))).await;
    relay.shutdown().await?;
    result.context("relay timeout")?
}

#[cfg(all(test, windows))]
mod restart {
    use super::*;
    use pig_pairing::identity;
    use std::{env, fs, process::Command};

    #[test]
    fn persisted_pair_reconnects_after_process_exit() -> Result<()> {
        let profiles = tempfile::tempdir()?;
        for name in ["host", "client"] {
            fs::create_dir(profiles.path().join(name))?;
        }
        // Separate processes ensure neither the keys nor the allowlist survive in memory.
        for phase in ["pair", "reconnect", "after-revoke"] {
            let status = Command::new(env::current_exe()?)
                .args(["--ignored", "--exact", "restart::child"])
                .env("PIG_TEST_PAIR_PROFILES", profiles.path())
                .env("PIG_TEST_PAIR_PHASE", phase)
                .status()?;
            ensure!(status.success(), "restart phase {phase} failed");
        }
        Ok(())
    }

    #[tokio::test]
    #[ignore = "run by persisted_pair_reconnects_after_process_exit"]
    async fn child() -> Result<()> {
        timeout(Duration::from_secs(15), async {
            let root = std::path::PathBuf::from(env::var("PIG_TEST_PAIR_PROFILES")?);
            let phase = env::var("PIG_TEST_PAIR_PHASE")?;
            let key = if phase == "pair" {
                identity::create
            } else {
                identity::load
            };
            let host = endpoint_with_key(None, key(&root.join("host"))?).await?;
            let laptop = endpoint_with_key(None, key(&root.join("client"))?).await?;
            let mut store = PairingStore::open(&root.join("host/paired.sqlite"), host.id())?;
            let target = root.join("client/trusted-host");
            let invite = if phase == "pair" {
                Some(store.issue()?)
            } else {
                None
            };
            let host_id = match &invite {
                Some(invite) => invite.host,
                None => fs::read_to_string(&target)?.parse()?,
            };
            let dst = EndpointAddr::new(host_id).with_ip_addr(host.bound_sockets()[0]);
            let (server, client) = dial(&host, dst, &laptop).await?;
            ensure!(client.remote_id() == host_id);
            if let Some(invite) = invite {
                ensure!(store.redeem(&invite, server.remote_id())?);
                fs::write(target, host_id.to_string())?;
            }
            if phase == "after-revoke" {
                ensure!(!authorize(&server, &store)?);
                expect_close(&client, b"not paired").await?;
            } else {
                ensure!(authorize(&server, &store)?);
                if phase == "reconnect" {
                    store.revoke(server.remote_id())?;
                }
            }
            tokio::join!(host.close(), laptop.close());
            Ok(())
        })
        .await?
    }
}

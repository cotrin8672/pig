//! Native transport for the Tauri Bun host. One bounded request per authenticated connection.
use anyhow::{Context, Result, ensure};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, endpoint::presets};
use pig_pairing::{Invite, PairingStore, identity};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::{Semaphore, mpsc, oneshot},
    time::timeout,
};

const ALPN: &[u8] = b"pig/remote/1";
const MAX: usize = 64 * 1024;
const REPLY: usize = 2 * 1024 * 1024;
type Query = (EndpointId, Value, u64, oneshot::Sender<Value>);
fn store(dir: &Path, host: EndpointId) -> Result<PairingStore> {
    PairingStore::open(&dir.join("paired.sqlite"), host)
}
/// Display label only: at most 64 printable characters.
fn label(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(64).collect()
}
fn machine_name() -> String {
    label(&env::var("COMPUTERNAME").unwrap_or_default())
}
fn local() -> bool {
    cfg!(debug_assertions) && env::var("PIG_REMOTE_LOOPBACK").as_deref() == Ok("1")
}
async fn endpoint(dir: &Path) -> Result<Endpoint> {
    let b = if local() {
        Endpoint::builder(presets::Minimal)
            .clear_ip_transports()
            .clear_address_lookup()
            .relay_mode(RelayMode::Disabled)
            .bind_addr((Ipv4Addr::LOCALHOST, 0))?
    } else {
        Endpoint::builder(presets::N0)
    };
    Ok(b.secret_key(identity::load(dir)?)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await?)
}
async fn handle(
    incoming: iroh::endpoint::Incoming,
    host: EndpointId,
    dir: Arc<PathBuf>,
    tx: mpsc::Sender<Query>,
    deadline: u64,
) -> Result<()> {
    let conn = incoming.await?;
    let peer = conn.remote_id();
    let (mut out, mut input) = conn.accept_bi().await?;
    let data = input.read_to_end(MAX).await?;
    let msg: Value = serde_json::from_slice(&data).context("invalid frame")?;
    let mut db = store(&dir, host)?;
    let reply = if msg.get("op").and_then(Value::as_str) == Some("pair") {
        let invite: Invite = msg["invite"].as_str().context("missing invite")?.parse()?;
        let name = label(msg["name"].as_str().unwrap_or_default());
        let ok = db.redeem(&invite, peer, &name)?;
        if ok {
            json!({"ok":true,"name":machine_name()})
        } else {
            json!({"ok":false})
        }
    } else if msg["op"] == "ping" {
        if db.is_paired(peer)? {
            json!({"ok":true,"name":machine_name()})
        } else {
            json!({"ok":false})
        }
    } else if db.is_paired(peer)? {
        let (done, recv) = oneshot::channel();
        tx.try_send((peer, msg, deadline, done))
            .map_err(|_| anyhow::anyhow!("busy"))?;
        let value =
            tokio::select! { r=recv=>r?, _=conn.closed()=>anyhow::bail!("peer disconnected") };
        ensure!(db.is_paired(peer)?, "revoked");
        value
    } else {
        json!({"ok":false,"error":"not paired"})
    };
    let bytes = serde_json::to_vec(&reply)?;
    ensure!(bytes.len() <= REPLY, "oversize response");
    out.write_all(&bytes).await?;
    out.finish()?;
    let _ = out.stopped().await?;
    Ok(())
}
async fn serve(dir: PathBuf) -> Result<()> {
    let ep = endpoint(&dir).await?;
    println!("[\"ready\"]");
    if local() {
        fs::write(dir.join("loopback"), ep.bound_sockets()[0].to_string())?;
    }
    let dir = Arc::new(dir);
    let slots = Arc::new(Semaphore::new(8));
    let (tx, mut queries) = mpsc::channel::<Query>(8);
    let mut replies = BufReader::new(tokio::io::stdin()).lines();
    let mut pending = HashMap::<u64, oneshot::Sender<Value>>::new();
    let mut seq = 0u64;
    let mut cleanup = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            it = ep.accept() => {
                let Some(incoming) = it else {break};
                let Ok(permit) = slots.clone().try_acquire_owned() else {incoming.refuse();continue};
                let (dir,tx,id)=(dir.clone(),tx.clone(),ep.id());
                let budget=Duration::from_secs(35);
                let deadline=(SystemTime::now().duration_since(UNIX_EPOCH)?+budget).as_millis() as u64;
                tokio::spawn(async move {let _permit=permit; let _=timeout(budget,handle(incoming,id,dir,tx,deadline)).await;});
            }
            _=cleanup.tick(), if !pending.is_empty()=> {
                pending.retain(|id,s| {if s.is_closed(){println!("{}",json!(["cancel",id]));false}else{true}});
            }
            Some((peer,msg,deadline,done)) = queries.recv() => {
                seq += 1;
                pending.insert(seq,done);
                println!("{}",json!([seq,ep.id().to_string(),peer.to_string(),msg,deadline]));
            }
            line = replies.next_line() => {
                let Some(line) = line? else {break};
                let (id,v):(u64,Value)=serde_json::from_str(&line)?;
                if let Some(s)=pending.remove(&id) {let _=s.send(v);}
            }
        }
    }
    ep.close().await;
    Ok(())
}
fn stdin_text() -> Result<String> {
    let mut text = String::new();
    std::io::stdin()
        .take((MAX + 1) as u64)
        .read_to_string(&mut text)?;
    ensure!(text.len() <= MAX, "input too large");
    Ok(text.trim().to_owned())
}
#[tokio::main]
async fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let op = args
        .next()
        .context("expected init|id|invite|cancel|revoke|serve|pair|call")?;
    let dir = PathBuf::from(args.next().context("expected private pairing directory")?);
    if op == "init" {
        fs::create_dir_all(&dir)?;
        println!("{}", identity::create(&dir)?.public());
        return Ok(());
    }
    if op == "serve" {
        return serve(dir).await;
    }
    let id = identity::load(&dir)?.public();
    match op.as_str() {
        "id" => println!("{id}"),
        "invite" => println!("{}", store(&dir, id)?.issue()?.for_copy()),
        "cancel" => store(&dir, id)?.cancel_invite()?,
        "revoke" => store(&dir, id)?.revoke(args.next().context("expected peer key")?.parse()?)?,
        "pair" | "recover" | "call" => {
            let text = if op == "recover" {
                String::new()
            } else {
                stdin_text()?
            };
            let pin = dir.join("trusted-host");
            let (host, req) = if op == "pair" {
                let invite: Invite = text.parse()?;
                (
                    invite.host,
                    json!({"op":"pair","invite":text,"name":machine_name()}),
                )
            } else if op == "recover" {
                (
                    args.next().context("expected host key")?.parse()?,
                    json!({"op":"ping"}),
                )
            } else {
                (
                    fs::read_to_string(&pin)?.parse()?,
                    serde_json::from_str(&text)?,
                )
            };
            let result: Value = timeout(Duration::from_secs(45), async {
                let ep = endpoint(&dir).await?;
                let mut dst = EndpointAddr::new(host);
                if local() {
                    let addr: SocketAddr = env::var("PIG_REMOTE_TEST_ADDR")?.parse()?;
                    ensure!(addr.ip().is_loopback(), "expected loopback");
                    dst = dst.with_ip_addr(addr);
                }
                let c = ep.connect(dst, ALPN).await?;
                ensure!(c.remote_id() == host, "host mismatch");
                // Progress for the desktop UI; the request itself follows.
                eprintln!("pig-remote: connected");
                let (mut out, mut input) = c.open_bi().await?;
                out.write_all(&serde_json::to_vec(&req)?).await?;
                out.finish()?;
                let v = serde_json::from_slice(&input.read_to_end(REPLY).await?)?;
                ep.close().await;
                Ok::<Value, anyhow::Error>(v)
            })
            .await
            .context("request timed out; do not retry a send automatically")??;
            if op != "call" && result["ok"] == true {
                eprintln!("pig-remote: registering");
                let mut tmp = tempfile::NamedTempFile::new_in(&dir)?;
                tmp.write_all(host.to_string().as_bytes())?;
                tmp.as_file().sync_all()?;
                tmp.persist(pin)?;
                let _ = fs::write(
                    dir.join("host-name"),
                    label(result["name"].as_str().unwrap_or_default()),
                );
            }
            println!("{}", result);
            ensure!(result["ok"] == true, "request not accepted");
        }
        _ => anyhow::bail!("unknown command"),
    }
    Ok(())
}

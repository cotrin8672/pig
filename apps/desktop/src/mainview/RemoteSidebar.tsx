import { Folder, Monitor, Plus, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PairingHost } from "../shared/pairing";
import type { RemoteChatItem, RemoteProject } from "../shared/remote-workspace";
import { navigate } from "./navigation";
import { Button } from "./primitives/Button";
import { IconButton } from "./primitives/IconButton";
import { RemoteProjectPicker } from "./RemoteProjectPicker";
import { remote } from "./remote-workspace";
import { openRemoteDraft, rpc } from "./rpc";
import { showError, useStore } from "./store";

let openSequence = 0;
function ProjectChats({
  host,
  project,
}: {
  host: PairingHost;
  project: RemoteProject;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<RemoteChatItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads the same page after failure or new chat creation.
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setBusy(true);
    setError(false);
    remote(host.id, { op: "list", project: project.id, offset })
      .then(
        (result) => {
          if (!active) return;
          setTotal(result.total);
          setRows((old) =>
            offset ? [...old.slice(0, offset), ...result.chats] : result.chats,
          );
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    const refresh = () => setRetry((n) => n + 1);
    window.addEventListener("remote-chat-created", refresh);
    return () => {
      active = false;
      window.removeEventListener("remote-chat-created", refresh);
    };
  }, [host.id, project.id, expanded, offset, retry]);
  async function open(chat: RemoteChatItem) {
    const seq = ++openSequence;
    setOpening(true);
    try {
      const result = await remote(host.id, { op: "open", chat: chat.chat });
      if (seq !== openSequence || !alive.current) return;
      useStore.setState({
        remoteThread: {
          chat: result.chat,
          host: host.id,
          hostName: host.name,
          project: project.id,
          projectName: project.name,
          title: chat.title || "新しいチャット",
          view: result.view,
        },
      });
      navigate("remoteChat");
    } catch (e) {
      showError(e);
    } finally {
      if (alive.current) setOpening(false);
    }
  }
  return (
    <section className="project">
      <div className="project-heading">
        <button
          className="project-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setOffset(0);
          }}
        >
          <Folder size={13} />
          <span className="project-name">{project.name}</span>
        </button>
        <IconButton
          disabled={opening || host.online === false}
          aria-label={`${host.name}の${project.name}で新しいチャット`}
          onClick={() => {
            ++openSequence;
            openRemoteDraft({
              host: host.id,
              hostName: host.name,
              project: project.id,
            });
          }}
        >
          <SquarePen size={13} />
        </IconButton>
      </div>
      {expanded && (
        <div className="project-threads">
          {rows.map((c) => (
            <button
              key={c.chat}
              className="remote-chat-row"
              type="button"
              disabled={opening}
              onClick={() => void open(c)}
            >
              {c.title || "無題"}
            </button>
          ))}
          {busy ? (
            <p className="sidebar-empty">読み込み中…</p>
          ) : error ? (
            <Button onClick={() => setRetry((n) => n + 1)}>一覧を再取得</Button>
          ) : rows.length < total ? (
            <Button onClick={() => setOffset(rows.length)}>
              以前のチャット
            </Button>
          ) : (
            !rows.length && (
              <p className="sidebar-empty">チャットはありません。</p>
            )
          )}
        </div>
      )}
    </section>
  );
}
export function RemoteSidebar() {
  const hosts = useStore((s) => s.remoteHosts);
  const [picker, setPicker] = useState<string>();
  useEffect(() => {
    let active = true,
      revision = 0;
    const load = () => {
      const ticket = ++revision;
      void rpc.request.remoteHosts({}).then(
        (next) => {
          if (active && ticket === revision)
            useStore.setState({ remoteHosts: next });
        },
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("remote-sidebar-changed", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("remote-sidebar-changed", load);
    };
  }, []);
  return (
    <>
      {hosts.map((h) => (
        <section className="sidebar-section" key={h.id}>
          <div className="sidebar-section-heading">
            <h2>
              <Monitor size={13} /> {h.name}{" "}
              {h.online === false ? "· オフライン" : ""}
            </h2>
            <IconButton
              aria-label={`${h.name}からProjectを追加`}
              onClick={() => setPicker(h.id)}
            >
              <Plus size={14} />
            </IconButton>
          </div>
          {h.projects?.length ? (
            h.projects.map((p) => (
              <ProjectChats key={p.id} host={h} project={p} />
            ))
          ) : (
            <Button onClick={() => setPicker(h.id)}>Projectを追加…</Button>
          )}
          {picker === h.id && (
            <div className="pairing-motion">
              <RemoteProjectPicker
                host={h}
                close={() => setPicker(undefined)}
              />
            </div>
          )}
        </section>
      ))}
    </>
  );
}

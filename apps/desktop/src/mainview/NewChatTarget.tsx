import { useMemo, useState } from "react";
import { projectLabel } from "../shared/projects";
import { type ChatTarget, ChatTargetTray } from "./ChatTargetTray";
import { useT } from "./i18n";
import { navigate } from "./navigation";
import { RemoteProjectPicker } from "./RemoteProjectPicker";
import { rpc } from "./rpc";
import { useStore } from "./store";

const local = "local";

export function NewChatTarget({
  openId,
  busy,
}: {
  openId: string;
  busy: boolean;
}) {
  const t = useT();
  const hosts = useStore((s) => s.remoteHosts);
  const target = useStore((s) => s.pendingOpens[openId]);
  const { generalCwd, projects, desktop } = useStore((s) => s.bootstrap);
  const [addFor, setAddFor] = useState<string>();
  const cwd = target?.cwd;
  const localProjects = useMemo(
    () =>
      projects
        .filter(
          (path) =>
            path !== generalCwd &&
            (path === cwd || !desktop.projects?.[path]?.archived),
        )
        .map((path) => ({
          id: path,
          name: projectLabel(path, desktop.projects?.[path]),
        })),
    [projects, desktop.projects, generalCwd, cwd],
  );
  if (!target?.deferred) return null;
  const remote = target.remote;
  const pcs = [
    { id: local, name: t.chatTargetLocal, online: true, local: true },
    ...hosts.map((host) => ({ ...host, online: host.online !== false })),
  ];
  if (remote && !hosts.some((host) => host.id === remote.host))
    pcs.push({ id: remote.host, name: remote.hostName, online: false });
  const addHost = hosts.find((host) => host.id === addFor);
  function select(next: ChatTarget) {
    useStore.setState((s) => {
      const pending = s.pendingOpens[openId];
      if (!pending?.deferred) return s;
      const host = s.remoteHosts.find((item) => item.id === next.pc);
      if (next.pc !== local && (!host || host.online === false)) return s;
      const updated = {
        ...pending,
        cwd: host ? pending.cwd : (next.project ?? generalCwd),
        remote: host
          ? { host: host.id, hostName: host.name, project: next.project }
          : undefined,
      };
      return {
        pendingOpens: { ...s.pendingOpens, [openId]: updated },
        ...(s.openId === openId ? { openingTarget: updated } : {}),
      };
    });
  }
  return (
    <>
      <ChatTargetTray
        pcs={pcs}
        projects={{
          ...Object.fromEntries(
            hosts.map((host) => [host.id, host.projects ?? []]),
          ),
          [local]: localProjects,
        }}
        value={
          remote
            ? { pc: remote.host, project: remote.project }
            : {
                pc: local,
                project: target.cwd === generalCwd ? undefined : target.cwd,
              }
        }
        onChange={select}
        onConnect={() => {
          useStore.setState({ pairingConnectRequested: true });
          navigate("pairing");
        }}
        onAddProject={(pc) =>
          pc === local ? rpc.send.addProject() : setAddFor(pc)
        }
        busy={busy}
      />
      {addHost && (
        <div className="pairing-motion">
          <RemoteProjectPicker
            key={addHost.id}
            host={addHost}
            close={() => setAddFor(undefined)}
          />
        </div>
      )}
    </>
  );
}

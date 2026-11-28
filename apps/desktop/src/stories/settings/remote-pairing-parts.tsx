import { Link2, Monitor, Plus, SquarePen } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IndicatorDot } from "../../mainview/IndicatorDot";
import {
  CONNECT_STEPS,
  ConnectBody,
  type ConnectState,
  InviteBody,
  type InviteStage,
} from "../../mainview/PairingDialogs";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { Sheet } from "../../mainview/patterns/Sheet";
import { Button } from "../../mainview/primitives/Button";
import { RemoteProjectPicker } from "../../mainview/RemoteProjectPicker";
import { SessionList } from "../../mainview/SessionList";
import { ProjectSessions } from "../../mainview/SidebarSessions";
import { useStore } from "../../mainview/store";
import { TooltipLayer, useTooltip } from "../../mainview/Tooltip";
import { setStoryRemoteProjectRequests } from "../browser-rpc";
import SidebarPreview from "../current-ui/SidebarPreview";
import "../../mainview/settings.css";
import "./remote-pairing-story.css";
import "../motion/snappy-motion.css";

/*
 * Shared by the Remote Pairing stories. 構成の根拠（2026-11 調査）:
 * - Codex（ChatGPT desktop）: Settings > Connections の「Control other devices」で接続先PCを登録し、
 *   サイドバーの「Add project → Remote」で接続先PC上のフォルダーを選ぶと Remote Project として並ぶ。
 * - openai/codex#24295: 「接続先 → Project → チャット」のまとまりが強く要望されている。
 *   pig は接続先PCごとにサイドバーの欄を作る。
 * - OpenCode / Conductor / Claude Code: 招待コード（QR）・失効までの残り時間・端末一覧と即時失効。
 * PC 同士ではカメラを前提にできないため、QR ではなく招待コードのコピー＆貼り付けにする。
 */

export const HOST_NAME = "自宅PC";
export const NEW_DEVICE = "Surface Laptop";
export const remote = (path: string) => `pig-remote://home/${path}`;
export const HOST_CHATS = remote("general");
const BASE = "C:/Users/gummy/ghq/github.com/cotrin8672";

export type RemoteProject = { cwd: string; path: string; titles: string[] };
export const hostProjects: RemoteProject[] = [
  {
    cwd: remote(`${BASE}/pig`),
    path: `${BASE}/pig`,
    titles: ["Remote Pairing の設計", "スクロールバーの端を修正"],
  },
  {
    cwd: remote(`${BASE}/piris`),
    path: `${BASE}/piris`,
    titles: ["画像の取り込みを高速化"],
  },
  {
    cwd: remote(`${BASE}/url-product-compare`),
    path: `${BASE}/url-product-compare`,
    titles: ["価格表の比較ロジック"],
  },
  {
    cwd: remote("C:/Users/gummy/dotfiles"),
    path: "C:/Users/gummy/dotfiles",
    titles: ["mise の設定を整理"],
  },
];
export const hostChatTitles = [
  "引っ越しの手続きメモ",
  "論文の要約",
  "旅行の予定",
];
// Folders on the host, for adding a folder that is not a project yet.
const folderTree: Record<string, string[]> = {
  [remote(`${BASE}/pig`)]: ["apps", "docs", "packages"],
  [remote(`${BASE}/pig/apps`)]: ["desktop"],
  [remote(`${BASE}/piris`)]: ["src"],
};

export type Device = {
  id: string;
  name: string;
  online: boolean;
  seen: string;
};
export type Host = {
  id: string;
  name: string;
  online: boolean;
  chats: boolean;
  projects: string[];
};
export type Dialog = "invite" | "connect" | "add" | "add-folder";
export interface PairingArgs {
  allow: boolean;
  devices: Device[];
  hosts: Host[];
  dialog?: Dialog;
  connectError?: boolean;
}

export const sampleDevices: Device[] = [
  { id: "lab", name: "研究室PC", online: true, seen: "" },
  { id: "laptop", name: "ThinkPad X1", online: false, seen: "2日前" },
];
export const sampleHome: Host = {
  id: "home",
  name: HOST_NAME,
  online: true,
  chats: true,
  projects: [hostProjects[0].cwd, hostProjects[1].cwd],
};

export const INVITE =
  "pig-pair:1:8f3c91a4e0b7d2654c19f83a7e20b4d1c58a9e3f27b604d1e8c3a5f7b290a91e:4d7e1b90c3a25f84e61d20b9a7c3f5821e4d9a6c0b7f382e5a1d9c4b6e80f213";
const INVITE_SECONDS = 12 * 60 * 60;
const DEMO_PAIR_MS = 2500;
const CONNECT_STEP_MS = 450;
// Collapse time of `.snappy-collapse`; the row is removed after it closes.
const COLLAPSE_MS = 120;

export const leaf = (path: string) => path.split("/").pop() ?? path;
export const projectName = (cwd: string) =>
  leaf(hostProjects.find((p) => p.cwd === cwd)?.path ?? cwd);
const projectOption = (id: string) => ({
  id,
  name: id === HOST_CHATS ? "Projectなしのチャット" : projectName(id),
});

/** Storybook simulation only; no device is contacted. */
export function useConnect(initial = "", initiallyFailed = false) {
  const [value, setValue] = useState(initial);
  const [step, setStep] = useState(initiallyFailed ? 0 : -1);
  const [failed, setFailed] = useState(initiallyFailed);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  const state: ConnectState = failed
    ? "error"
    : step >= CONNECT_STEPS.length
      ? "connected"
      : step >= 0
        ? "connecting"
        : "input";
  function clear(next = "") {
    clearInterval(timer.current);
    setValue(next);
    setStep(-1);
    setFailed(false);
  }
  return {
    value,
    step,
    state,
    setValue: clear,
    submit(onConnected?: () => void) {
      if (!value.trim() || state === "connecting" || state === "connected")
        return;
      setStep(0);
      const valid = value.trim().startsWith("pig-pair:1:");
      setFailed(!valid);
      if (!valid) return;
      let next = 0;
      timer.current = setInterval(() => {
        setStep(++next);
        if (next >= CONNECT_STEPS.length) {
          clearInterval(timer.current);
          onConnected?.();
        }
      }, CONNECT_STEP_MS);
    },
    reset: () => clear(),
    cancel: () => clearInterval(timer.current),
  };
}
export type Connect = ReturnType<typeof useConnect>;

/** Puts the host's chats into the preview store so the production lists render them. */
function useHostSessions() {
  useLayoutEffect(() => {
    const now = Date.now();
    const infos = (cwd: string, titles: string[]) =>
      titles.map((title, index) => ({
        id: `${cwd}#${index}`,
        cwd,
        title,
        modified: now - (index + 1) * 3_600_000,
      }));
    useStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [HOST_CHATS]: infos(HOST_CHATS, hostChatTitles),
        ...Object.fromEntries(
          hostProjects.map((p) => [p.cwd, infos(p.cwd, p.titles)]),
        ),
      },
    }));
  }, []);
}

/** All pairing state of one story: every layout drives the same flows. */
export function usePairing(args: PairingArgs) {
  useHostSessions();
  const [allow, setAllowState] = useState(args.allow);
  const [devices, setDevices] = useState(args.devices);
  const [hosts, setHosts] = useState(args.hosts);
  useLayoutEffect(() => {
    const registered = new Set(hostProjects.map(({ cwd }) => cwd));
    return setStoryRemoteProjectRequests({
      remoteWorkspace({ query }) {
        switch (query.op) {
          case "projects":
            return [HOST_CHATS, ...registered].map(projectOption);
          case "folders": {
            const { parent } = query;
            return (
              parent
                ? (folderTree[parent] ?? []).map((name) => `${parent}/${name}`)
                : [...registered]
            ).map(projectOption);
          }
          case "addFolder":
            registered.add(query.folder);
            return projectOption(query.folder);
          default:
            throw new Error("この操作はプレビューに接続していません。");
        }
      },
      remoteProjectsSave({ id, projects }) {
        setHosts((list) =>
          list.map((host) =>
            host.id === id
              ? {
                  ...host,
                  chats: projects.some((p) => p.id === HOST_CHATS),
                  projects: projects
                    .filter((p) => p.id !== HOST_CHATS)
                    .map((p) => p.id),
                }
              : host,
          ),
        );
        return true;
      },
    });
  }, []);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [open, setOpen] = useState<Dialog | undefined>(args.dialog);
  const [inviteStage, setInviteStage] = useState<InviteStage>("idle");
  const paired = inviteStage === "paired";
  const [expires, setExpires] = useState<number | undefined>(
    args.dialog === "invite" ? Date.now() + INVITE_SECONDS * 1000 : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const connection = useConnect(
    args.connectError ? "無効なコード" : "",
    args.connectError,
  );
  const pairTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!expires) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expires]);
  useEffect(() => () => clearTimeout(pairTimer.current), []);

  function later(id: string, done: () => void) {
    setLeaving((ids) => [...ids, id]);
    setTimeout(() => {
      done();
      setLeaving((ids) => ids.filter((other) => other !== id));
    }, COLLAPSE_MS);
  }
  function cancelInvite() {
    clearTimeout(pairTimer.current);
    setExpires(undefined);
    setOpen(undefined);
  }
  const model = {
    allow,
    devices,
    hosts,
    leaving,
    open,
    paired,
    inviteStage,
    expires,
    left: expires ? Math.max(0, Math.round((expires - now) / 1000)) : 0,
    connection,
    setOpen,
    setAllow(next: boolean) {
      setAllowState(next);
      if (!next) cancelInvite();
    },
    removeDevice: (id: string) =>
      later(id, () => setDevices((list) => list.filter((d) => d.id !== id))),
    removeHost: (id: string) =>
      later(id, () => setHosts((list) => list.filter((h) => h.id !== id))),
    openInvite() {
      if (!expires) setExpires(Date.now() + INVITE_SECONDS * 1000);
      setInviteStage("idle");
      setOpen("invite");
    },
    cancelInvite,
    closeInvite() {
      setOpen(undefined);
      if (paired) setExpires(undefined);
    },
    copied() {
      clearTimeout(pairTimer.current);
      if (!paired) setInviteStage("waiting");
      pairTimer.current = setTimeout(() => {
        setInviteStage("paired");
        setDevices((list) => [
          { id: `pc-${Date.now()}`, name: NEW_DEVICE, online: true, seen: "" },
          ...list,
        ]);
      }, DEMO_PAIR_MS);
    },
    openConnect() {
      connection.reset();
      setOpen("connect");
    },
    closeConnect() {
      connection.cancel();
      setOpen(undefined);
    },
    submitCode() {
      connection.submit(() => {
        setHosts((list) =>
          list.length
            ? list
            : [
                {
                  id: "home",
                  name: HOST_NAME,
                  online: true,
                  chats: false,
                  projects: [],
                },
              ],
        );
      });
    },
    /** Shows or hides one host item (a project cwd, or HOST_CHATS) in the sidebar. */
    toggleShown(hostId: string, item: string, shown: boolean) {
      setHosts((list) =>
        list.map((host) => {
          if (host.id !== hostId) return host;
          if (item === HOST_CHATS) return { ...host, chats: shown };
          const rest = host.projects.filter((cwd) => cwd !== item);
          return { ...host, projects: shown ? [...rest, item] : rest };
        }),
      );
    },
  };
  return model;
}
export type Pairing = ReturnType<typeof usePairing>;

/** Grows in and collapses out, so lists never jump. */
function Grow({
  leaving,
  children,
}: {
  leaving?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="snappy-collapse mac-grow"
      data-open={leaving ? undefined : ""}
      inert={leaving}
    >
      <div>{children}</div>
    </div>
  );
}

export function AddRow({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="mac-add-row"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={14} aria-hidden="true" />
      {children}
    </button>
  );
}

/** The host's section in the sidebar: chats without a project, then its projects. */
function RemoteHostSection({ host, onAdd }: { host: Host; onAdd: () => void }) {
  const tooltip = useTooltip();
  return (
    <section className="sidebar-section remote-host" aria-label={host.name}>
      <div className="sidebar-section-heading">
        <h2>
          <Monitor size={11} aria-hidden="true" />
          {host.name}
          {host.online ? (
            <IndicatorDot state="completed" label="接続中" />
          ) : (
            <span className="remote-host-offline">オフライン</span>
          )}
        </h2>
        <span className="remote-host-actions">
          <button
            type="button"
            aria-label={`${host.name}で新しいチャット`}
            disabled={!host.online}
            {...tooltip({
              tier: "label",
              side: "top",
              label: `${host.name}で新しいチャット`,
            })}
          >
            <SquarePen size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${host.name}からProjectを追加`}
            disabled={!host.online}
            onClick={onAdd}
            {...tooltip({ tier: "label", side: "top", label: "Projectを追加" })}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </span>
      </div>
      <Grow leaving={!host.chats}>
        <SessionList cwd={HOST_CHATS} />
      </Grow>
      {host.projects.map((cwd) => (
        <Grow key={cwd}>
          <ProjectSessions cwd={cwd} />
        </Grow>
      ))}
      {!host.chats && !host.projects.length && (
        <AddRow onClick={onAdd}>{host.name}のProjectを追加</AddRow>
      )}
    </section>
  );
}

function PairingSheets({ p }: { p: Pairing }) {
  const picker = p.open === "add" || p.open === "add-folder";
  const host = p.hosts[0];
  return (
    <>
      <Sheet
        open={p.open === "invite"}
        title="PCを追加"
        onClose={p.closeInvite}
        footer={
          p.paired ? (
            <Button variant="primary" onClick={p.closeInvite}>
              完了
            </Button>
          ) : (
            <ConfirmButton onConfirm={p.cancelInvite}>
              コードを取り消す
            </ConfirmButton>
          )
        }
      >
        <InviteBody
          code={INVITE}
          peer={NEW_DEVICE}
          left={p.left}
          stage={p.inviteStage}
          onCopy={p.copied}
        />
      </Sheet>

      <Sheet
        open={p.open === "connect"}
        title="PCに接続"
        onClose={p.closeConnect}
        footer={
          p.connection.state === "connected" ? (
            <>
              <Button onClick={p.closeConnect}>あとで</Button>
              <Button variant="primary" onClick={() => p.setOpen("add")}>
                Projectを選ぶ…
              </Button>
            </>
          ) : undefined
        }
      >
        <ConnectBody
          c={{ ...p.connection, host: HOST_NAME }}
          submit={p.submitCode}
        />
      </Sheet>

      {picker && host && (
        <RemoteProjectPicker
          host={{
            ...host,
            projects: [
              ...(host.chats ? [HOST_CHATS] : []),
              ...host.projects,
            ].map(projectOption),
          }}
          initialTab={p.open === "add-folder" ? "folders" : "projects"}
          close={() => p.setOpen(undefined)}
        />
      )}
    </>
  );
}

/** The real sidebar with remote sections, the Pairing icon, and every sheet. */
export function PairingShell({
  p,
  active = true,
  children,
}: {
  p: Pairing;
  /** Whether the Pairing page is the one shown. */
  active?: boolean;
  children: ReactNode;
}) {
  const tooltip = useTooltip();
  const anyOnline =
    (p.allow && p.devices.some((device) => device.online)) ||
    p.hosts.some((host) => host.online);
  return (
    <SidebarPreview
      sessionsAfter={p.hosts.map((host) => (
        <RemoteHostSection
          key={host.id}
          host={host}
          onAdd={() => p.setOpen("add")}
        />
      ))}
      afterStatistics={
        <button
          type="button"
          className={`sidebar-icon ${active ? "active" : ""}`}
          aria-label={`Pairing: ${p.allow ? "接続を許可中" : "オフ"}`}
          aria-pressed={active}
          {...tooltip({ tier: "label", side: "top", label: "Pairing" })}
        >
          <Link2 size={16} aria-hidden="true" />
          {(p.allow || p.hosts.length > 0) && (
            <span
              className={`sidebar-provider-dot ${anyOnline ? "connected" : ""}`}
              aria-hidden="true"
            />
          )}
        </button>
      }
      main={
        <div className="pairing-motion">
          {children}
          <PairingSheets p={p} />
        </div>
      }
    />
  );
}

/** Wraps a layout with the shared state, shell and tooltips. */
export function PairingStory({
  args,
  page,
  pageActive,
}: {
  args: PairingArgs;
  page: (p: Pairing) => ReactNode;
  pageActive?: boolean;
}) {
  return (
    <TooltipLayer>
      <PairingHost args={args} page={page} pageActive={pageActive} />
    </TooltipLayer>
  );
}
function PairingHost({
  args,
  page,
  pageActive,
}: {
  args: PairingArgs;
  page: (p: Pairing) => ReactNode;
  pageActive?: boolean;
}) {
  const p = usePairing(args);
  return (
    <PairingShell p={p} active={pageActive}>
      {page(p)}
    </PairingShell>
  );
}

import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Folder,
  Link2,
  MessageSquare,
  Monitor,
  Plus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActionsMenu } from "../../mainview/patterns/ActionsMenu";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { Button } from "../../mainview/primitives/Button";
import { Checkbox } from "../../mainview/primitives/Checkbox";
import { IconButton } from "../../mainview/primitives/IconButton";
import { IndicatorDot } from "../../mainview/primitives/IndicatorDot";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { TextField } from "../../mainview/primitives/TextField";
import { SessionList } from "../../mainview/SessionList";
import { ProjectSessions } from "../../mainview/SidebarSessions";
import { useStore } from "../../mainview/store";
import { TooltipLayer, useTooltip } from "../../mainview/Tooltip";
import SidebarPreview from "../current-ui/SidebarPreview";
import { SpinnerCheck } from "../motion/SpinnerCheck";
import "../../mainview/settings.css";
// Holds the shared centering rule of non-modal dialogs (.oauth-dialog).
import "../../mainview/model-dividers.css";
import "./remote-pairing-story.css";

/*
 * Shared by every Remote Pairing proposal. 構成の根拠（2026-11 調査）:
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
  "C:/Users/gummy": ["Desktop", "Documents", "dotfiles", "ghq", "work"],
  "C:/Users/gummy/ghq": ["github.com"],
  "C:/Users/gummy/ghq/github.com": ["cotrin8672"],
  [BASE]: ["blog", "pig", "piris", "scratch", "url-product-compare"],
  "C:/Users/gummy/work": ["lab-report", "slides"],
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
const DEMO_CONNECT_MS = 1200;
// Collapse time of `.snappy-collapse`; the row is removed after it closes.
const COLLAPSE_MS = 120;

export const clock = (seconds: number) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
};
export const leaf = (path: string) => path.split("/").pop() ?? path;
export const projectName = (cwd: string) =>
  leaf(hostProjects.find((p) => p.cwd === cwd)?.path ?? cwd);

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
  const [leaving, setLeaving] = useState<string[]>([]);
  const [open, setOpen] = useState<Dialog | undefined>(args.dialog);
  const [paired, setPaired] = useState(false);
  const [expires, setExpires] = useState<number | undefined>(
    args.dialog === "invite" ? Date.now() + INVITE_SECONDS * 1000 : undefined,
  );
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState(
    args.connectError ? "pig-pair:1:5c1e04a7…" : "",
  );
  const [connect, setConnect] = useState<
    "input" | "connecting" | "connected" | "error"
  >(args.connectError ? "error" : "input");
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
    expires,
    left: expires ? Math.max(0, Math.round((expires - now) / 1000)) : 0,
    code,
    connect,
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
      setPaired(false);
      setOpen("invite");
    },
    cancelInvite,
    closeInvite() {
      setOpen(undefined);
      if (paired) setExpires(undefined);
    },
    copied() {
      clearTimeout(pairTimer.current);
      pairTimer.current = setTimeout(() => {
        setPaired(true);
        setDevices((list) => [
          { id: `pc-${Date.now()}`, name: NEW_DEVICE, online: true, seen: "" },
          ...list,
        ]);
      }, DEMO_PAIR_MS);
    },
    openConnect() {
      setCode("");
      setConnect("input");
      setOpen("connect");
    },
    setCode(value: string) {
      setCode(value);
      if (connect === "error") setConnect("input");
    },
    submitCode() {
      if (!code.trim().startsWith("pig-pair:1:")) return setConnect("error");
      setConnect("connecting");
      setTimeout(() => {
        setConnect("connected");
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
      }, DEMO_CONNECT_MS);
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
    addToHost(projects: string[], chats: boolean) {
      setHosts((list) =>
        list.map((host, index) =>
          index
            ? host
            : {
                ...host,
                chats: host.chats || chats,
                projects: [
                  ...host.projects,
                  ...projects.filter((cwd) => !host.projects.includes(cwd)),
                ],
              },
        ),
      );
      setOpen(undefined);
    },
  };
  return model;
}
export type Pairing = ReturnType<typeof usePairing>;

/** Non-modal like the sign-in dialog; always mounted so closing plays in reverse. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement as HTMLElement | null;
      node.show();
      node
        .querySelector<HTMLElement>("input:not([type=checkbox]), .primary")
        ?.focus();
    } else if (!open && node.open) {
      node.close();
      opener.current?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="oauth-dialog mac-sheet"
      data-wide={wide || undefined}
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <IconButton aria-label="閉じる" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      </div>
      {children}
      {footer && <div className="dialog-actions">{footer}</div>}
    </dialog>
  );
}

export function Tile({
  children,
  tone,
  size,
}: {
  children: ReactNode;
  tone?: "neutral";
  size?: "large";
}) {
  return (
    <span className="mac-tile" data-tone={tone} data-size={size}>
      {children}
    </span>
  );
}

/** Grows in and collapses out, so lists never jump. */
export function Grow({
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

export function ListRow({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SettingsRow
      className="mac-row"
      label={
        <span className="mac-row-label">
          {icon}
          <span>
            <span className="mac-row-title">{title}</span>
            {detail && <span className="mac-row-detail">{detail}</span>}
          </span>
        </span>
      }
    >
      {children && <span className="mac-row-actions">{children}</span>}
    </SettingsRow>
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

export function RemoveMenu({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <ActionsMenu label={`${name}の操作`}>
      {(close) => (
        <ConfirmButton
          role="menuitem"
          className="session-menu-delete"
          onConfirm={() => {
            close();
            onRemove();
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
          削除
        </ConfirmButton>
      )}
    </ActionsMenu>
  );
}

/** Connected / offline line shared by every layout. */
export function Presence({
  online,
  children,
}: {
  online: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {online && <IndicatorDot state="completed" />}
      {online ? "接続中" : "オフライン"}
      {children}
    </>
  );
}

export const hostSummary = (host: Host) =>
  host.projects.length || host.chats
    ? `Project ${host.projects.length}件${host.chats ? "とチャット" : ""}を表示中`
    : "サイドバーには未追加";

export function CopyButton({
  text,
  onCopy,
}: {
  text: string;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(0);
  const [failed, setFailed] = useState(false);
  return (
    <span className="mac-copy">
      {failed && (
        <span className="mac-row-detail">選択してコピーしてください</span>
      )}
      <Button
        variant="primary"
        onClick={async () => {
          onCopy();
          try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            setCopied(Date.now());
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? (
          <Check
            key={copied}
            size={14}
            className="snappy-pop"
            aria-hidden="true"
          />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        <span className="mac-swap">
          <span aria-hidden={!!copied}>コピー</span>
          <span aria-hidden={!copied}>コピー済み</span>
        </span>
      </Button>
    </span>
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

function AddFromHost({
  open,
  folder,
  host,
  onClose,
  onAdd,
}: {
  open: boolean;
  folder: boolean;
  host?: Host;
  onClose: () => void;
  onAdd: (projects: string[], chats: boolean) => void;
}) {
  const [tab, setTab] = useState<"existing" | "folder">(
    folder ? "folder" : "existing",
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [chats, setChats] = useState(false);
  const [dir, setDir] = useState(BASE);
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setChats(false);
    setSelected(undefined);
  }, [open]);
  useEffect(() => setTab(folder ? "folder" : "existing"), [folder]);
  if (!host) return null;
  const added = (cwd: string) => host.projects.includes(cwd);
  const existing = (path: string) => hostProjects.find((p) => p.path === path);
  const count = picked.length + (chats ? 1 : 0);
  const parent = dir.slice(0, dir.lastIndexOf("/"));
  const toggle = (cwd: string) =>
    setPicked((list) =>
      list.includes(cwd)
        ? list.filter((other) => other !== cwd)
        : [...list, cwd],
    );
  return (
    <Sheet
      open={open}
      wide
      title={`${host.name}から追加`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          {tab === "existing" ? (
            <Button
              variant="primary"
              disabled={!count}
              onClick={() => onAdd(picked, chats)}
            >
              {count ? `${count}件を追加` : "追加"}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!selected}
              onClick={() =>
                selected &&
                onAdd([existing(selected)?.cwd ?? remote(selected)], false)
              }
            >
              このフォルダーを追加
            </Button>
          )}
        </>
      }
    >
      <SegmentedControl
        className="mac-sheet-tabs"
        aria-label="追加するもの"
        value={tab}
        onChange={setTab}
        options={[
          { value: "existing", label: "既存のProject" },
          { value: "folder", label: "フォルダーを選択" },
        ]}
      />
      {tab === "existing" ? (
        <div key="existing" className="mac-list mac-pick">
          <label className="mac-pick-row" data-done={host.chats || undefined}>
            <Checkbox
              checked={host.chats || chats}
              disabled={host.chats}
              onChange={(event) => setChats(event.target.checked)}
            />
            <Tile tone="neutral">
              <MessageSquare size={14} aria-hidden="true" />
            </Tile>
            <span>
              <span className="mac-row-title">Projectなしのチャット</span>
              <span className="mac-row-detail">
                {hostChatTitles.length}件のチャット
              </span>
            </span>
            {host.chats && <span className="mac-row-detail">追加済み</span>}
          </label>
          {hostProjects.map((project) => (
            <label
              key={project.cwd}
              className="mac-pick-row"
              data-done={added(project.cwd) || undefined}
            >
              <Checkbox
                checked={added(project.cwd) || picked.includes(project.cwd)}
                disabled={added(project.cwd)}
                onChange={() => toggle(project.cwd)}
              />
              <Tile tone="neutral">
                <Folder size={14} aria-hidden="true" />
              </Tile>
              <span>
                <span className="mac-row-title">{leaf(project.path)}</span>
                <span className="mac-row-detail mac-path">{project.path}</span>
              </span>
              <span className="mac-row-detail">
                {added(project.cwd) ? "追加済み" : `${project.titles.length}件`}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div key="folder" className="mac-list mac-pick">
          <div className="mac-crumb">
            <IconButton
              aria-label="上のフォルダーへ"
              disabled={!folderTree[parent]}
              onClick={() => {
                setDir(parent);
                setSelected(undefined);
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </IconButton>
            <span className="mac-path">{dir}</span>
          </div>
          {(folderTree[dir] ?? []).map((name) => {
            const path = `${dir}/${name}`;
            const known = existing(path);
            return (
              <div
                key={path}
                className="mac-folder-row"
                data-selected={selected === path || undefined}
              >
                <button
                  type="button"
                  className="mac-folder-pick"
                  aria-pressed={selected === path}
                  onClick={() => setSelected(path)}
                >
                  <Folder size={14} aria-hidden="true" />
                  <span className="mac-row-title">{name}</span>
                  {known && (
                    <span className="mac-row-detail">
                      {added(known.cwd) ? "追加済み" : "Project"}
                    </span>
                  )}
                </button>
                {folderTree[path] && (
                  <IconButton
                    aria-label={`${name}を開く`}
                    onClick={() => {
                      setDir(path);
                      setSelected(undefined);
                    }}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mac-note">
        {tab === "existing"
          ? `ファイルと実行は${host.name}に残ります。このPCには一覧と会話だけが表示されます。`
          : selected
            ? `選択中: ${selected}`
            : `${host.name}上のフォルダーを選ぶと、新しいProjectとして追加します。`}
      </p>
    </Sheet>
  );
}

function PairingSheets({ p }: { p: Pairing }) {
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
        <InviteBody left={p.left} paired={p.paired} onCopy={p.copied} />
      </Sheet>

      <Sheet
        open={p.open === "connect"}
        title="PCに接続"
        onClose={() => p.setOpen(undefined)}
        footer={
          p.connect === "connected" ? (
            <>
              <Button onClick={() => p.setOpen(undefined)}>あとで</Button>
              <Button variant="primary" onClick={() => p.setOpen("add")}>
                Projectを選ぶ…
              </Button>
            </>
          ) : undefined
        }
      >
        <ConnectBody
          code={p.code}
          connect={p.connect}
          setCode={p.setCode}
          submit={p.submitCode}
        />
      </Sheet>

      <AddFromHost
        open={p.open === "add" || p.open === "add-folder"}
        folder={p.open === "add-folder"}
        host={p.hosts[0]}
        onClose={() => p.setOpen(undefined)}
        onAdd={p.addToHost}
      />
    </>
  );
}

/** Body of the invite sheet: steps, the code, its expiry and the pairing state. */
export function InviteBody({
  left,
  paired,
  onCopy,
}: {
  left: number;
  paired: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <ol className="mac-steps">
        <li>このコードをコピーして、追加するPCに渡す</li>
        <li>追加するPCのpigで「Pairing → PCに接続…」に貼り付ける</li>
      </ol>
      <div className="mac-code-box">
        <code className="mac-code">{INVITE}</code>
        <div className="mac-code-footer">
          <span className="mac-row-detail" role="timer">
            残り {clock(left)} · 1回限り
          </span>
          <CopyButton text={INVITE} onCopy={onCopy} />
        </div>
      </div>
      <div className="mac-status" role="status">
        <SpinnerCheck done={paired} />
        {paired
          ? `${NEW_DEVICE} を追加しました`
          : "追加するPCでの貼り付けを待っています…"}
      </div>
      <p className="mac-note">
        追加したPCは、このPCのProjectとチャットを開き、このPCでモデルとツールを実行できます。
      </p>
    </>
  );
}

export type ConnectState = "input" | "connecting" | "connected" | "error";
/** Body of the connect sheet: steps, the code field and the connection state. */
export function ConnectBody({
  code,
  connect,
  setCode,
  submit,
}: {
  code: string;
  connect: ConnectState;
  setCode: (value: string) => void;
  submit: () => void;
}) {
  const p = { code, connect, setCode };
  return (
    <>
      <ol className="mac-steps">
        <li>接続先のPCのpigで「Pairing → PCを追加…」を押す</li>
        <li>表示された招待コードをここに貼り付ける</li>
      </ol>
      <form
        className="input-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          className="mac-code-input"
          aria-label="招待コード"
          placeholder="pig-pair:1:…"
          autoComplete="off"
          spellCheck={false}
          value={p.code}
          disabled={p.connect === "connecting" || p.connect === "connected"}
          onChange={(event) => p.setCode(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={
            !p.code.trim() ||
            p.connect === "connecting" ||
            p.connect === "connected"
          }
        >
          接続
        </Button>
      </form>
      {p.connect === "error" && (
        <div className="oauth-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          このコードは使用済みか期限切れです。接続先のPCで新しいコードを作ってください。
        </div>
      )}
      {(p.connect === "connecting" || p.connect === "connected") && (
        <div className="mac-status" role="status">
          <SpinnerCheck done={p.connect === "connected"} />
          {p.connect === "connected"
            ? `${HOST_NAME} に接続しました。サイドバーに表示するProjectを選べます。`
            : "接続しています…"}
        </div>
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

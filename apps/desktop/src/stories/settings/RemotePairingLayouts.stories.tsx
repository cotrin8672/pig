import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  KeyRound,
  Laptop,
  Link2,
  MessageSquare,
  Minus,
  Monitor,
  Plus,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { ContentPage } from "../../mainview/ContentPage";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { Button } from "../../mainview/primitives/Button";
import { SearchField } from "../../mainview/primitives/SearchField";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { Switch } from "../../mainview/primitives/Switch";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import {
  AddRow,
  clock,
  Grow,
  HOST_CHATS,
  type Host,
  hostChatTitles,
  hostProjects,
  hostSummary,
  ListRow,
  leaf,
  type Pairing,
  type PairingArgs,
  PairingStory,
  Presence,
  RemoveMenu,
  sampleDevices,
  sampleHome,
  Tile,
} from "./remote-pairing-parts";
import "./remote-pairing-layouts.css";

const THIS_PC = "DESKTOP-GUMMY";
const description =
  "自分のPC同士をつなぎ、別のPCのProjectとチャットをこのPCのサイドバーで使えます。";

function AllowSwitch({
  p,
  label = "他のPCからの接続を許可",
}: {
  p: Pairing;
  label?: string;
}) {
  return (
    <label className="layout-switch">
      <span>{label}</span>
      <Switch
        aria-label={label}
        checked={p.allow}
        onChange={(event) => p.setAllow(event.target.checked)}
      />
    </label>
  );
}

/** Every item a host can show in the sidebar, with its current state. */
function hostItems(host: Host) {
  return [
    {
      id: HOST_CHATS,
      name: "Projectなしのチャット",
      detail: `${hostChatTitles.length}件`,
      shown: host.chats,
      icon: <MessageSquare size={13} aria-hidden="true" />,
    },
    ...hostProjects.map((project) => ({
      id: project.cwd,
      name: leaf(project.path),
      detail: `${project.titles.length}件`,
      shown: host.projects.includes(project.cwd),
      icon: <Folder size={13} aria-hidden="true" />,
    })),
  ];
}

// B: 接続マップ

const ROW = 76;
function Wires({
  ys,
  center,
  height,
  side,
  live,
}: {
  ys: number[];
  center: number;
  height: number;
  side: "left" | "right";
  live: boolean[];
}) {
  return (
    <svg className="topo-wires" width="72" height={height} aria-hidden="true">
      {ys.map((y, index) => {
        const [from, to] = side === "left" ? [y, center] : [center, y];
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: wires follow the node order.
            key={index}
            data-live={live[index] || undefined}
            d={`M0 ${from} C36 ${from}, 36 ${to}, 72 ${to}`}
          />
        );
      })}
    </svg>
  );
}
function TopologyNode({
  icon,
  name,
  detail,
  children,
  online,
}: {
  icon: ReactNode;
  name: string;
  detail: ReactNode;
  children?: ReactNode;
  online?: boolean;
}) {
  return (
    <div className="topo-slot">
      <div className="topo-node ui-card" data-online={online || undefined}>
        {icon}
        <span className="topo-node-text">
          <span className="mac-row-title">{name}</span>
          <span className="mac-row-detail">{detail}</span>
        </span>
        <span className="mac-row-actions">{children}</span>
      </div>
    </div>
  );
}
function TopologyPage({ p }: { p: Pairing }) {
  const left = p.devices.length + 1;
  const right = p.hosts.length + 1;
  const height = Math.max(left, right, 3) * ROW;
  const ys = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => (height - n * ROW) / 2 + i * ROW + ROW / 2,
    );
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={description}
    >
      <div className="topo-legend">
        <span>このPCを使えるPC</span>
        <span>このPC</span>
        <span>接続先のPC</span>
      </div>
      <div
        className="topo-stage"
        style={{ "--topo-h": `${height}px` } as CSSProperties}
      >
        <div className="topo-col">
          {p.devices.map((device) => (
            <TopologyNode
              key={device.id}
              online={p.allow && device.online}
              icon={
                <Tile tone="neutral">
                  <Laptop size={15} aria-hidden="true" />
                </Tile>
              }
              name={device.name}
              detail={<Presence online={p.allow && device.online} />}
            >
              <RemoveMenu
                name={device.name}
                onRemove={() => p.removeDevice(device.id)}
              />
            </TopologyNode>
          ))}
          <div className="topo-slot">
            <button
              type="button"
              className="topo-add"
              disabled={!p.allow}
              onClick={p.openInvite}
            >
              <Plus size={14} aria-hidden="true" />
              {p.expires ? `招待中 · 残り ${clock(p.left)}` : "PCを追加…"}
            </button>
          </div>
        </div>
        <Wires
          side="left"
          ys={ys(left)}
          center={height / 2}
          height={height}
          live={[...p.devices.map((d) => p.allow && d.online), false]}
        />
        <div className="topo-center">
          <div className="topo-core" data-on={p.allow || undefined}>
            <Laptop size={28} aria-hidden="true" />
          </div>
          <strong>{THIS_PC}</strong>
          <span className="mac-row-detail">このPC</span>
          <label className="layout-switch">
            <Switch
              aria-label="他のPCからの接続を許可"
              checked={p.allow}
              onChange={(event) => p.setAllow(event.target.checked)}
            />
            <span>{p.allow ? "接続を許可中" : "オフ"}</span>
          </label>
        </div>
        <Wires
          side="right"
          ys={ys(right)}
          center={height / 2}
          height={height}
          live={[...p.hosts.map((h) => h.online), false]}
        />
        <div className="topo-col">
          {p.hosts.map((host) => (
            <TopologyNode
              key={host.id}
              online={host.online}
              icon={
                <Tile tone="neutral">
                  <Monitor size={15} aria-hidden="true" />
                </Tile>
              }
              name={host.name}
              detail={hostSummary(host)}
            >
              <button
                type="button"
                className="layout-icon"
                aria-label="Projectを追加"
                onClick={() => p.setOpen("add")}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
              <RemoveMenu
                name={host.name}
                onRemove={() => p.removeHost(host.id)}
              />
            </TopologyNode>
          ))}
          <div className="topo-slot">
            <button type="button" className="topo-add" onClick={p.openConnect}>
              <Plus size={14} aria-hidden="true" />
              PCに接続…
            </button>
          </div>
        </div>
      </div>
    </ContentPage>
  );
}

// C: 2ペイン

type Pick = { kind: "self" } | { kind: "host" | "device"; id: string };
function SplitPage({ p }: { p: Pairing }) {
  const [pick, setPick] = useState<Pick>(
    p.hosts[0] ? { kind: "host", id: p.hosts[0].id } : { kind: "self" },
  );
  const menu = useId();
  const host =
    pick.kind === "host" ? p.hosts.find((h) => h.id === pick.id) : undefined;
  const device =
    pick.kind === "device"
      ? p.devices.find((d) => d.id === pick.id)
      : undefined;
  const current = (host ?? device) ? pick : { kind: "self" as const };
  const item = (
    target: Pick,
    icon: ReactNode,
    name: string,
    online?: boolean,
  ) => {
    const active =
      target.kind === current.kind &&
      ("id" in target ? "id" in current && current.id === target.id : true);
    return (
      <button
        type="button"
        className="split-item"
        aria-current={active || undefined}
        onClick={() => setPick(target)}
      >
        {icon}
        <span>{name}</span>
        {online !== undefined && (
          <span className="split-dot" data-online={online || undefined} />
        )}
      </button>
    );
  };
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={description}
    >
      <SettingsCard className="split-card">
        <nav className="split-nav" aria-label="PC">
          <div className="split-scroll">
            {item(
              { kind: "self" },
              <Laptop size={14} aria-hidden="true" />,
              "このPC",
              p.allow,
            )}
            <h3 className="split-heading">接続先</h3>
            {p.hosts.map((h) => (
              <Grow key={h.id} leaving={p.leaving.includes(h.id)}>
                {item(
                  { kind: "host", id: h.id },
                  <Monitor size={14} aria-hidden="true" />,
                  h.name,
                  h.online,
                )}
              </Grow>
            ))}
            <h3 className="split-heading">このPCを使えるPC</h3>
            {p.devices.map((d) => (
              <Grow key={d.id} leaving={p.leaving.includes(d.id)}>
                {item(
                  { kind: "device", id: d.id },
                  <Laptop size={14} aria-hidden="true" />,
                  d.name,
                  p.allow && d.online,
                )}
              </Grow>
            ))}
          </div>
          {/* macOS list editing: + and − under the list. */}
          <div className="split-tools">
            <button
              type="button"
              className="split-tool split-plus"
              aria-label="PCを追加"
              popoverTarget={menu}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <div
              id={menu}
              popover="auto"
              className="session-menu split-menu"
              role="menu"
            >
              <button type="button" role="menuitem" onClick={p.openConnect}>
                <ArrowRight size={13} aria-hidden="true" />
                接続先のPCを追加…
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!p.allow}
                onClick={p.openInvite}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                このPCを使えるPCを追加…
              </button>
            </div>
            <ConfirmButton
              className="split-tool"
              aria-label="選択したPCを削除"
              disabled={current.kind === "self"}
              onConfirm={() => {
                if (host) p.removeHost(host.id);
                if (device) p.removeDevice(device.id);
                setPick({ kind: "self" });
              }}
            >
              <Minus size={14} aria-hidden="true" />
            </ConfirmButton>
          </div>
        </nav>
        <section key={JSON.stringify(current)} className="split-detail">
          {host ? (
            <>
              <header className="split-header">
                <Tile size="large">
                  <Monitor size={22} aria-hidden="true" />
                </Tile>
                <span>
                  <h2>{host.name}</h2>
                  <span className="mac-row-detail">
                    <Presence online={host.online}>
                      {" "}
                      · {hostSummary(host)}
                    </Presence>
                  </span>
                </span>
              </header>
              <h3 className="settings-group-title">サイドバーに表示</h3>
              <SettingsCard className="mac-list">
                {hostItems(host).map((entry) => (
                  <ListRow
                    key={entry.id}
                    icon={<Tile tone="neutral">{entry.icon}</Tile>}
                    title={entry.name}
                    detail={entry.detail}
                  >
                    <label>
                      <Switch
                        aria-label={`${entry.name}をサイドバーに表示`}
                        checked={entry.shown}
                        onChange={(event) =>
                          p.toggleShown(host.id, entry.id, event.target.checked)
                        }
                      />
                    </label>
                  </ListRow>
                ))}
                <AddRow
                  disabled={!host.online}
                  onClick={() => p.setOpen("add-folder")}
                >
                  フォルダーを選んで追加…
                </AddRow>
              </SettingsCard>
            </>
          ) : device ? (
            <>
              <header className="split-header">
                <Tile size="large" tone="neutral">
                  <Laptop size={22} aria-hidden="true" />
                </Tile>
                <span>
                  <h2>{device.name}</h2>
                  <span className="mac-row-detail">
                    <Presence online={p.allow && device.online}>
                      {device.seen && ` · ${device.seen}に接続`}
                    </Presence>
                  </span>
                </span>
              </header>
              <p className="mac-note">
                このPCのProjectとチャットを開き、このPCでモデルとツールを実行できます。
              </p>
              <ConfirmButton
                onConfirm={() => {
                  p.removeDevice(device.id);
                  setPick({ kind: "self" });
                }}
              >
                アクセスを取り消す
              </ConfirmButton>
            </>
          ) : (
            <>
              <header className="split-header">
                <Tile size="large">
                  <Laptop size={22} aria-hidden="true" />
                </Tile>
                <span>
                  <h2>{THIS_PC}</h2>
                  <span className="mac-row-detail">このPC</span>
                </span>
              </header>
              <SettingsCard className="mac-list">
                <ListRow
                  icon={
                    <Tile>
                      <Link2 size={15} aria-hidden="true" />
                    </Tile>
                  }
                  title="他のPCからの接続を許可"
                  detail={
                    p.allow ? "待ち受け中" : "オフの間は外部と通信しません"
                  }
                >
                  <label>
                    <Switch
                      aria-label="他のPCからの接続を許可"
                      checked={p.allow}
                      onChange={(e) => p.setAllow(e.target.checked)}
                    />
                  </label>
                </ListRow>
                <ListRow
                  icon={
                    <Tile tone="neutral">
                      <KeyRound size={15} aria-hidden="true" />
                    </Tile>
                  }
                  title="招待コード"
                  detail={
                    p.expires
                      ? `有効 · 残り ${clock(p.left)}`
                      : "PCを追加するときに作ります"
                  }
                >
                  <Button disabled={!p.allow} onClick={p.openInvite}>
                    {p.expires ? "表示…" : "作成…"}
                  </Button>
                </ListRow>
              </SettingsCard>
            </>
          )}
        </section>
      </SettingsCard>
    </ContentPage>
  );
}

// D: 2つの入口

function DoorsPage({ p }: { p: Pairing }) {
  const pcs = [
    ...p.hosts.map((h) => ({
      id: h.id,
      name: h.name,
      online: h.online,
      out: true,
      host: h,
    })),
    ...p.devices.map((d) => ({
      id: d.id,
      name: d.name,
      online: p.allow && d.online,
      out: false,
      host: undefined,
    })),
  ];
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={description}
    >
      <div className="doors">
        <section className="door ui-card" data-on={p.allow || undefined}>
          <Tile size="large">
            <ArrowLeft size={22} aria-hidden="true" />
          </Tile>
          <h2>このPCを使えるようにする</h2>
          <p>外出先のPCから、このPCのProjectとチャットを開けます。</p>
          <div className="door-actions">
            <AllowSwitch p={p} label="接続を許可" />
            <Button
              variant="primary"
              disabled={!p.allow}
              onClick={p.openInvite}
            >
              {p.expires
                ? `招待コード（残り ${clock(p.left)}）`
                : "招待コードを作る…"}
            </Button>
          </div>
        </section>
        <section className="door ui-card">
          <Tile size="large">
            <ArrowRight size={22} aria-hidden="true" />
          </Tile>
          <h2>別のPCを使う</h2>
          <p>
            別のPCで作った招待コードを貼り付け、そのPCのProjectを追加します。
          </p>
          <div className="door-actions">
            <Button variant="primary" onClick={p.openConnect}>
              招待コードで接続…
            </Button>
          </div>
        </section>
      </div>
      <h3 className="settings-group-title">つながっているPC</h3>
      <div className="door-pills">
        {pcs.map((pc) => (
          <Grow key={pc.id} leaving={p.leaving.includes(pc.id)}>
            <div className="door-pill" data-online={pc.online || undefined}>
              {pc.out ? (
                <Monitor size={14} aria-hidden="true" />
              ) : (
                <Laptop size={14} aria-hidden="true" />
              )}
              <span>
                <span className="mac-row-title">{pc.name}</span>
                <span className="mac-row-detail">
                  {pc.out ? (
                    <ArrowRight size={11} aria-hidden="true" />
                  ) : (
                    <ArrowLeft size={11} aria-hidden="true" />
                  )}
                  {pc.host
                    ? hostSummary(pc.host)
                    : pc.online
                      ? "接続中"
                      : "オフライン"}
                </span>
              </span>
              {pc.host && (
                <button
                  type="button"
                  className="layout-icon"
                  aria-label="Projectを追加"
                  onClick={() => p.setOpen("add")}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              )}
              <RemoveMenu
                name={pc.name}
                onRemove={() =>
                  pc.out ? p.removeHost(pc.id) : p.removeDevice(pc.id)
                }
              />
            </div>
          </Grow>
        ))}
        {!pcs.length && (
          <p className="mac-note">まだつながっているPCはありません。</p>
        )}
      </div>
    </ContentPage>
  );
}

// E: 一覧表

function TablePage({ p }: { p: Pairing }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "out" | "in">("all");
  const rows = [
    ...p.hosts.map((h) => ({
      id: h.id,
      name: h.name,
      out: true,
      online: h.online,
      seen: h.online ? "今" : "昨日",
      host: h as Host | undefined,
    })),
    ...p.devices.map((d) => ({
      id: d.id,
      name: d.name,
      out: false,
      online: p.allow && d.online,
      seen: d.online ? "今" : d.seen,
      host: undefined,
    })),
  ].filter(
    (row) =>
      (filter === "all" || row.out === (filter === "out")) &&
      row.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={description}
      actions={<AllowSwitch p={p} />}
    >
      <div className="table-toolbar">
        <SearchField
          className="table-search"
          placeholder="PCを検索"
          aria-label="PCを検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          clearLabel="検索を消去"
        />
        <SegmentedControl
          aria-label="向き"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "すべて" },
            { value: "out", label: "接続先" },
            { value: "in", label: "接続元" },
          ]}
        />
        <span className="table-spacer" />
        <Button onClick={p.openConnect}>コードで接続…</Button>
        <Button variant="primary" disabled={!p.allow} onClick={p.openInvite}>
          招待コードを作る…
        </Button>
      </div>
      <SettingsCard className="table-card">
        <table className="pairing-table">
          <thead>
            <tr>
              <th>PC</th>
              <th>向き</th>
              <th>状態</th>
              <th>最終接続</th>
              <th>サイドバー</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-leaving={p.leaving.includes(row.id) || undefined}
              >
                <td>
                  <span className="table-name">
                    {row.out ? (
                      <Monitor size={14} aria-hidden="true" />
                    ) : (
                      <Laptop size={14} aria-hidden="true" />
                    )}
                    {row.name}
                  </span>
                </td>
                <td>
                  <span className="table-dir" data-out={row.out || undefined}>
                    {row.out ? "接続先" : "接続元"}
                  </span>
                </td>
                <td>
                  <span className="mac-row-detail">
                    <Presence online={row.online} />
                  </span>
                </td>
                <td className="table-muted">{row.seen || "—"}</td>
                <td className="table-muted">
                  {row.host
                    ? `${row.host.projects.length} Project${row.host.chats ? " ＋チャット" : ""}`
                    : "—"}
                </td>
                <td>
                  <span className="mac-row-actions">
                    {row.host && (
                      <Button
                        disabled={!row.online}
                        onClick={() => p.setOpen("add")}
                      >
                        Project…
                      </Button>
                    )}
                    <RemoveMenu
                      name={row.name}
                      onRemove={() =>
                        row.out ? p.removeHost(row.id) : p.removeDevice(row.id)
                      }
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="settings-empty">該当するPCはありません。</p>
        )}
      </SettingsCard>
    </ContentPage>
  );
}

// F: タイル

function TilesPage({ p }: { p: Pairing }) {
  const [open, setOpen] = useState<string | undefined>(p.hosts[0]?.id);
  const host = p.hosts.find((h) => h.id === open);
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide"
      description={description}
    >
      <div className="tiles">
        <div
          className="tile-card tile-self ui-card"
          data-on={p.allow || undefined}
        >
          <span className="tile-top">
            <Laptop size={20} aria-hidden="true" />
            <Switch
              aria-label="他のPCからの接続を許可"
              checked={p.allow}
              onChange={(e) => p.setAllow(e.target.checked)}
            />
          </span>
          <strong>このPC</strong>
          <span className="mac-row-detail">
            {p.allow ? "接続を許可中" : "接続を受け付けない"}
          </span>
        </div>
        {p.hosts.map((h) => (
          <Grow key={h.id} leaving={p.leaving.includes(h.id)}>
            <button
              type="button"
              className="tile-card ui-card"
              aria-expanded={open === h.id}
              data-online={h.online || undefined}
              onClick={() => setOpen(open === h.id ? undefined : h.id)}
            >
              <span className="tile-top">
                <Monitor size={20} aria-hidden="true" />
                <span
                  className="split-dot"
                  data-online={h.online || undefined}
                />
              </span>
              <strong>{h.name}</strong>
              <span className="mac-row-detail">{hostSummary(h)}</span>
            </button>
          </Grow>
        ))}
        {p.devices.map((d) => (
          <Grow key={d.id} leaving={p.leaving.includes(d.id)}>
            <div
              className="tile-card ui-card"
              data-online={(p.allow && d.online) || undefined}
            >
              <span className="tile-top">
                <Laptop size={20} aria-hidden="true" />
                <RemoveMenu
                  name={d.name}
                  onRemove={() => p.removeDevice(d.id)}
                />
              </span>
              <strong>{d.name}</strong>
              <span className="mac-row-detail">
                <ArrowLeft size={11} aria-hidden="true" />
                {p.allow && d.online ? "このPCを使用中" : "オフライン"}
              </span>
            </div>
          </Grow>
        ))}
        <button
          type="button"
          className="tile-card tile-add"
          onClick={p.openConnect}
        >
          <ArrowRight size={18} aria-hidden="true" />
          <strong>PCに接続…</strong>
        </button>
        <button
          type="button"
          className="tile-card tile-add"
          disabled={!p.allow}
          onClick={p.openInvite}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          <strong>{p.expires ? `招待中 ${clock(p.left)}` : "PCを招待…"}</strong>
        </button>
      </div>
      <Grow leaving={!host}>
        {host && (
          <section className="shelf ui-card">
            <header>
              <strong>{host.name}から表示するもの</strong>
              <span className="mac-row-actions">
                <Button onClick={() => p.setOpen("add-folder")}>
                  フォルダーを追加…
                </Button>
                <RemoveMenu
                  name={host.name}
                  onRemove={() => {
                    p.removeHost(host.id);
                    setOpen(undefined);
                  }}
                />
              </span>
            </header>
            <div className="shelf-chips">
              {hostItems(host).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="shelf-chip"
                  aria-pressed={entry.shown}
                  onClick={() => p.toggleShown(host.id, entry.id, !entry.shown)}
                >
                  {entry.icon}
                  {entry.name}
                  <small>{entry.detail}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </Grow>
    </ContentPage>
  );
}

// G: 軌道（近未来）

function OrbitPage({ p }: { p: Pairing }) {
  const [focus, setFocus] = useState<string>();
  const nodes = [
    ...p.hosts.map((h, i) => ({
      id: h.id,
      name: h.name,
      online: h.online,
      ring: 1,
      angle: -30 + i * 50,
      out: true,
      host: h as Host | undefined,
    })),
    ...p.devices.map((d, i) => ({
      id: d.id,
      name: d.name,
      online: p.allow && d.online,
      ring: 2,
      angle: 150 + i * 42,
      out: false,
      host: undefined,
    })),
  ];
  const picked = nodes.find((node) => node.id === focus) ?? nodes[0];
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide orbit-page"
      description={description}
    >
      <div className="orbit">
        <div className="orbit-stage ui-card" data-on={p.allow || undefined}>
          <span className="orbit-ring" data-ring="1" aria-hidden="true" />
          <span className="orbit-ring" data-ring="2" aria-hidden="true" />
          <span className="orbit-sweep" aria-hidden="true" />
          <button
            type="button"
            className="orbit-core"
            aria-pressed={p.allow}
            aria-label={
              p.allow ? "接続の許可をやめる" : "他のPCからの接続を許可"
            }
            onClick={() => p.setAllow(!p.allow)}
          >
            <Laptop size={26} aria-hidden="true" />
            <small>{p.allow ? "ONLINE" : "OFF"}</small>
          </button>
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className="orbit-node"
              data-online={node.online || undefined}
              aria-pressed={picked?.id === node.id}
              style={
                {
                  "--angle": `${node.angle}deg`,
                  "--radius": `${node.ring === 1 ? 118 : 178}px`,
                } as CSSProperties
              }
              onClick={() => setFocus(node.id)}
            >
              <span className="orbit-node-dot">
                {node.out ? (
                  <Monitor size={14} aria-hidden="true" />
                ) : (
                  <Laptop size={14} aria-hidden="true" />
                )}
              </span>
              <span className="orbit-node-name">{node.name}</span>
            </button>
          ))}
          <div className="orbit-adds">
            <button
              type="button"
              className="orbit-add"
              disabled={!p.allow}
              onClick={p.openInvite}
            >
              <Plus size={12} aria-hidden="true" /> 招待
            </button>
            <button type="button" className="orbit-add" onClick={p.openConnect}>
              <Plus size={12} aria-hidden="true" /> 接続
            </button>
          </div>
        </div>
        <aside className="orbit-hud ui-card">
          {picked ? (
            <>
              <span className="orbit-hud-label">
                {picked.out ? "OUTBOUND · 接続先" : "INBOUND · 接続元"}
              </span>
              <h2>{picked.name}</h2>
              <dl>
                <dt>状態</dt>
                <dd>
                  <Presence online={picked.online} />
                </dd>
                <dt>経路</dt>
                <dd>{picked.online ? "直接 · 12 ms" : "—"}</dd>
                <dt>暗号化</dt>
                <dd>E2E（端末鍵）</dd>
                {picked.host && (
                  <>
                    <dt>表示中</dt>
                    <dd>{hostSummary(picked.host)}</dd>
                  </>
                )}
              </dl>
              <div className="mac-row-actions">
                {picked.host && (
                  <Button
                    variant="primary"
                    disabled={!picked.online}
                    onClick={() => p.setOpen("add")}
                  >
                    Projectを追加…
                  </Button>
                )}
                <RemoveMenu
                  name={picked.name}
                  onRemove={() =>
                    picked.out
                      ? p.removeHost(picked.id)
                      : p.removeDevice(picked.id)
                  }
                />
              </div>
            </>
          ) : (
            <p className="mac-note">
              中央の「このPC」を押して接続を許可し、PCを招待または接続します。
            </p>
          )}
        </aside>
      </div>
    </ContentPage>
  );
}

// H: 奥行きガラス（近未来）

function DepthPage({ p }: { p: Pairing }) {
  // Start from the middle card, so the deck fans out to both sides.
  const [front, setFront] = useState(
    Math.min(1, p.hosts.length + p.devices.length - 1),
  );
  const cards = [
    ...p.hosts.map((h) => ({
      id: h.id,
      host: h as Host | undefined,
      name: h.name,
      online: h.online,
    })),
    ...p.devices.map((d) => ({
      id: d.id,
      host: undefined,
      name: d.name,
      online: p.allow && d.online,
    })),
  ];
  return (
    <ContentPage
      title="Pairing"
      className="settings-page layout-wide depth-page"
      description={description}
    >
      <div className="depth-ornament ui-card">
        <AllowSwitch p={p} label="このPCへの接続" />
        <span className="depth-sep" />
        <button
          type="button"
          className="depth-pill"
          disabled={!p.allow}
          onClick={p.openInvite}
        >
          <ArrowLeft size={13} aria-hidden="true" />
          {p.expires ? `招待中 ${clock(p.left)}` : "PCを招待"}
        </button>
        <button type="button" className="depth-pill" onClick={p.openConnect}>
          <ArrowRight size={13} aria-hidden="true" />
          PCに接続
        </button>
      </div>
      <div className="depth-stage">
        {cards.map((card, index) => {
          const offset = index - front;
          return (
            <button
              key={card.id}
              type="button"
              className="depth-card ui-card"
              data-front={offset === 0 || undefined}
              data-online={card.online || undefined}
              aria-pressed={offset === 0}
              style={
                {
                  "--offset": offset,
                  "--depth": Math.abs(offset),
                } as CSSProperties
              }
              onClick={() => setFront(index)}
            >
              <span className="depth-card-head">
                {card.host ? (
                  <Monitor size={18} aria-hidden="true" />
                ) : (
                  <Laptop size={18} aria-hidden="true" />
                )}
                <span
                  className="split-dot"
                  data-online={card.online || undefined}
                />
              </span>
              <strong>{card.name}</strong>
              <span className="mac-row-detail">
                {card.host ? (
                  <>
                    <ArrowRight size={11} aria-hidden="true" /> 接続先 ·{" "}
                    {hostSummary(card.host)}
                  </>
                ) : (
                  <>
                    <ArrowLeft size={11} aria-hidden="true" /> このPCを使えるPC
                  </>
                )}
              </span>
              {card.host && (
                <ul className="depth-projects">
                  {hostItems(card.host)
                    .filter((entry) => entry.shown)
                    .map((entry) => (
                      <li key={entry.id}>
                        {entry.icon}
                        {entry.name}
                      </li>
                    ))}
                </ul>
              )}
            </button>
          );
        })}
        {!cards.length && (
          <p className="mac-note">まだつながっているPCはありません。</p>
        )}
      </div>
      {cards[front] && (
        <div className="depth-actions">
          {cards[front].host && (
            <Button
              variant="primary"
              disabled={!cards[front].online}
              onClick={() => p.setOpen("add")}
            >
              Projectを追加…
            </Button>
          )}
          <RemoveMenu
            name={cards[front].name}
            onRemove={() => {
              const card = cards[front];
              if (card.host) p.removeHost(card.id);
              else p.removeDevice(card.id);
              setFront(0);
            }}
          />
        </div>
      )}
    </ContentPage>
  );
}

// stories

const layouts = {
  topology: TopologyPage,
  split: SplitPage,
  doors: DoorsPage,
  table: TablePage,
  tiles: TilesPage,
  orbit: OrbitPage,
  depth: DepthPage,
};
type LayoutArgs = PairingArgs & { layout: keyof typeof layouts };

const meta = {
  title: "Prototypes/Remote Pairing Layouts",
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "Remote Pairing 設定画面の別案。どの案も同じ状態と同じシート（招待コード・接続・Projectの追加）を使い、" +
          "サイドバーの接続先PC欄も共通。基準案は Settings/Remote Pairing。",
      },
    },
  },
  beforeEach: () => installPreview(previewDefaults),
  render: ({ layout, ...args }) => {
    const Page = layouts[layout];
    return (
      <PreviewTheme args={previewDefaults}>
        <PairingStory key={layout} args={args} page={(p) => <Page p={p} />} />
      </PreviewTheme>
    );
  },
  args: {
    layout: "topology",
    allow: true,
    devices: sampleDevices,
    hosts: [sampleHome],
  },
  argTypes: {
    layout: { control: false },
  },
} satisfies Meta<LayoutArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Topology: Story = {
  name: "B · 接続マップ",
  args: { layout: "topology" },
};
export const Split: Story = {
  name: "C · 2ペイン（PC一覧＋詳細）",
  args: { layout: "split" },
};
export const Doors: Story = {
  name: "D · 2つの入口",
  args: { layout: "doors" },
};
export const Table: Story = { name: "E · 一覧表", args: { layout: "table" } };
export const Tiles: Story = {
  name: "F · タイル＋Projectの棚",
  args: { layout: "tiles" },
};
export const Orbit: Story = {
  name: "G · 軌道（近未来）",
  args: { layout: "orbit" },
};
export const Depth: Story = {
  name: "H · 奥行きガラス（近未来）",
  args: { layout: "depth" },
};
export const FirstRun: Story = {
  name: "初回（各案の比較用・接続マップ）",
  args: { layout: "topology", allow: false, devices: [], hosts: [] },
};

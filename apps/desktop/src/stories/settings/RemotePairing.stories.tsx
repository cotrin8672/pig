import type { Meta, StoryObj } from "@storybook/react-vite";
import { Laptop, Monitor } from "lucide-react";
import { useState } from "react";
import { ContentPage } from "../../mainview/ContentPage";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { Button } from "../../mainview/primitives/Button";
import { SearchField } from "../../mainview/primitives/SearchField";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { Switch } from "../../mainview/primitives/Switch";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import {
  type Host,
  type Pairing,
  type PairingArgs,
  PairingStory,
  Presence,
  RemoveButton,
  sampleDevices,
  sampleHome,
} from "./remote-pairing-parts";
import "./remote-pairing-table.css";

const LABEL = "他のPCからの接続を許可";

/** Adopted layout: one table for both directions. */
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
      description="自分のPC同士をつなぎ、別のPCのProjectとチャットをこのPCのサイドバーで使えます。"
      actions={
        <label className="layout-switch">
          <span>{LABEL}</span>
          <Switch
            aria-label={LABEL}
            checked={p.allow}
            onChange={(event) => p.setAllow(event.target.checked)}
          />
        </label>
      }
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
        <Button onClick={p.openConnect}>PCに接続…</Button>
        <Button variant="primary" disabled={!p.allow} onClick={p.openInvite}>
          PCを追加…
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
                    <RemoveButton
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

const meta = {
  title: "Settings/Remote Pairing",
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "自分のPC同士をつなぎ、接続先PCのProject・チャットをこのPCのサイドバーに追加する。" +
          "デモ: 招待コードをコピーすると2.5秒後に登録完了。接続欄は pig-pair:1: で始まる文字列で成功する。",
      },
    },
  },
  beforeEach: () => installPreview(previewDefaults),
  render: (args) => (
    <PreviewTheme args={previewDefaults}>
      <PairingStory args={args} page={(p) => <TablePage p={p} />} />
    </PreviewTheme>
  ),
  args: { allow: true, devices: sampleDevices, hosts: [sampleHome] },
} satisfies Meta<PairingArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

const firstRun = { allow: false, devices: [], hosts: [] };
export const Table: Story = { name: "一覧" };
export const FirstRun: Story = { name: "初回", args: firstRun };
export const InviteDialog: Story = {
  name: "PCを追加",
  args: { dialog: "invite" },
};
export const ConnectDialog: Story = {
  name: "PCに接続",
  args: { ...firstRun, dialog: "connect" },
};
export const ConnectError: Story = {
  name: "PCに接続（コードが無効）",
  args: { ...firstRun, dialog: "connect", connectError: true },
};
export const AddProjects: Story = {
  name: "Projectを追加",
  args: { dialog: "add" },
};
export const AddFolder: Story = {
  name: "フォルダーを選んで追加",
  args: { dialog: "add-folder" },
};

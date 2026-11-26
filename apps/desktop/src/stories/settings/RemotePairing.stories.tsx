import type { Meta, StoryObj } from "@storybook/react-vite";
import { Laptop, Link2, Monitor } from "lucide-react";
import { ContentPage } from "../../mainview/ContentPage";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { Button } from "../../mainview/primitives/Button";
import { Switch } from "../../mainview/primitives/Switch";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import {
  AddRow,
  clock,
  Grow,
  hostSummary,
  ListRow,
  type Pairing,
  type PairingArgs,
  PairingStory,
  Presence,
  RemoveMenu,
  sampleDevices,
  sampleHome,
  Tile,
} from "./remote-pairing-parts";

/** 案A: macOS のシステム設定のような、2つの節に分けた角丸リスト。 */
function MacListPage({ p }: { p: Pairing }) {
  return (
    <ContentPage
      title="Pairing"
      className="settings-page mac-page"
      description="自分のPC同士をつなぎ、別のPCのProjectとチャットをこのPCのサイドバーで使えます。"
    >
      <SettingsCard className="mac-list">
        <ListRow
          icon={
            <Tile>
              <Link2 size={15} aria-hidden="true" />
            </Tile>
          }
          title="他のPCからの接続を許可"
          detail={
            p.allow
              ? "このPCで待ち受けています"
              : "オフの間は待ち受けず、外部と通信しません"
          }
        >
          <label>
            <Switch
              aria-label="他のPCからの接続を許可"
              checked={p.allow}
              onChange={(event) => p.setAllow(event.target.checked)}
            />
          </label>
        </ListRow>
      </SettingsCard>

      <h3 className="settings-group-title">このPCを使えるPC</h3>
      <SettingsCard className="mac-list">
        {p.devices.map((device) => (
          <Grow key={device.id} leaving={p.leaving.includes(device.id)}>
            <ListRow
              icon={
                <Tile tone="neutral">
                  <Laptop size={15} aria-hidden="true" />
                </Tile>
              }
              title={device.name}
              detail={
                <Presence online={p.allow && device.online}>
                  {!(p.allow && device.online) &&
                    device.seen &&
                    ` · ${device.seen}に接続`}
                </Presence>
              }
            >
              <RemoveMenu
                name={device.name}
                onRemove={() => p.removeDevice(device.id)}
              />
            </ListRow>
          </Grow>
        ))}
        <AddRow disabled={!p.allow} onClick={p.openInvite}>
          {p.expires
            ? `PCを追加…（招待コード 残り ${clock(p.left)}）`
            : "PCを追加…"}
        </AddRow>
      </SettingsCard>

      <h3 className="settings-group-title">接続先のPC</h3>
      <SettingsCard className="mac-list">
        {p.hosts.map((host) => (
          <Grow key={host.id} leaving={p.leaving.includes(host.id)}>
            <ListRow
              icon={
                <Tile tone="neutral">
                  <Monitor size={15} aria-hidden="true" />
                </Tile>
              }
              title={host.name}
              detail={
                <Presence online={host.online}> · {hostSummary(host)}</Presence>
              }
            >
              <Button disabled={!host.online} onClick={() => p.setOpen("add")}>
                Projectを追加…
              </Button>
              <RemoveMenu
                name={host.name}
                onRemove={() => p.removeHost(host.id)}
              />
            </ListRow>
          </Grow>
        ))}
        <AddRow onClick={p.openConnect}>PCに接続…</AddRow>
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
          "Codex App の Remote と同じ使い勝手：接続先PCをつなぎ、そのPCの既存Project・新しいフォルダー・Projectなしのチャットを" +
          "このPCのサイドバーに追加する。サイドバーは接続先PCごとの欄（接続先 → Project → チャット）にまとめる。" +
          "デモ: 招待コードをコピーすると2.5秒後に登録完了。接続欄は pig-pair:1: で始まる文字列で成功する。" +
          "別案は Prototypes/Remote Pairing Layouts。",
      },
    },
  },
  beforeEach: () => installPreview(previewDefaults),
  render: (args) => (
    <PreviewTheme args={previewDefaults}>
      <PairingStory args={args} page={(p) => <MacListPage p={p} />} />
    </PreviewTheme>
  ),
  args: { allow: false, devices: [], hosts: [] },
} satisfies Meta<PairingArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

const inUse = { allow: true, devices: sampleDevices, hosts: [sampleHome] };
export const Off: Story = { name: "01 · 初回" };
export const Connected: Story = {
  name: "02 · 使用中（サイドバーに自宅PC）",
  args: inUse,
};
export const AddProjects: Story = {
  name: "03 · 自宅PCからProjectを追加",
  args: { ...inUse, dialog: "add" },
};
export const AddFolder: Story = {
  name: "04 · 自宅PCのフォルダーを選んで追加",
  args: { ...inUse, dialog: "add-folder" },
};
export const InviteDialog: Story = {
  name: "05 · PCを追加（招待コード）",
  args: {
    allow: true,
    devices: sampleDevices.slice(1),
    hosts: [],
    dialog: "invite",
  },
};
export const ConnectError: Story = {
  name: "06 · PCに接続（コードが無効）",
  args: {
    allow: false,
    devices: [],
    hosts: [],
    dialog: "connect",
    connectError: true,
  },
};
// Keeps an earlier review link working.
export const SidebarEntryStates: Story = {
  name: "07 · サイドバーの Pairing",
  args: inUse,
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairingTable } from "../../mainview/PairingTable";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import {
  type PairingArgs,
  PairingStory,
  sampleDevices,
  sampleHome,
} from "./remote-pairing-parts";

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
      <PairingStory
        args={args}
        page={(p) => (
          <PairingTable
            {...p}
            addProjects={() => p.setOpen("add")}
            rows={[
              ...p.hosts.map((h) => ({
                ...h,
                out: true,
                seen: h.online ? "今" : "昨日",
                sidebar: `${h.projects.length} Project${h.chats ? " ＋チャット" : ""}`,
              })),
              ...p.devices.map((d) => ({
                ...d,
                out: false,
                online: p.allow && d.online,
                seen: d.online ? "今" : d.seen,
              })),
            ]}
          />
        )}
      />
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

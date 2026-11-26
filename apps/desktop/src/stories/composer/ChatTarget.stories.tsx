import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ChatEmpty, ChatLayout } from "../../mainview/ChatLayout";
import { Composer } from "../../mainview/Composer";
import { useStore } from "../../mainview/store";
// The Storybook alias only rewrites "./rpc"; import the mock directly.
import { rpc } from "../browser-rpc";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import { PreviewTheme } from "../current-ui/Previews";
import {
  leaf,
  type Pairing,
  type PairingArgs,
  PairingStory,
  projectName,
  sampleDevices,
  sampleHome,
} from "../settings/remote-pairing-parts";
import { type ChatPC, type ChatTarget, ChatTargetTray } from "./ChatTargetTray";

function NewChat({ p }: { p: Pairing }) {
  const snapshot = useStore((s) => s.snapshots[s.active ?? ""]);
  const local = useStore((s) => s.bootstrap.projects);
  const generalCwd = useStore((s) => s.bootstrap.generalCwd);
  const [target, setTarget] = useState<ChatTarget>({
    pc: "local",
    project: local[0],
  });
  if (!snapshot) return null;
  const pcs: ChatPC[] = [
    { id: "local", name: "このPC", local: true, online: true },
    ...p.hosts.map((host) => ({
      id: host.id,
      name: host.name,
      online: host.online,
    })),
    { id: "lab", name: "研究室PC", online: false },
  ];
  const projects = {
    local: local.map((cwd) => ({ id: cwd, name: leaf(cwd) })),
    ...Object.fromEntries(
      p.hosts.map((host) => [
        host.id,
        host.projects.map((cwd) => ({ id: cwd, name: projectName(cwd) })),
      ]),
    ),
  };
  return (
    <ChatLayout
      composer={
        <Composer
          snapshot={snapshot}
          above={
            <ChatTargetTray
              pcs={pcs}
              projects={projects}
              value={target}
              onChange={setTarget}
              onConnect={p.openConnect}
              onAddProject={(pc) =>
                pc === "local" ? rpc.send.addProject() : p.setOpen("add")
              }
            />
          }
        />
      }
    >
      <ChatEmpty cwd={target.project ?? generalCwd} />
    </ChatLayout>
  );
}

const meta = {
  title: "Design System/Domain/New Chat Target",
  parameters: {
    appPreview: true,
    docs: {
      description: {
        component:
          "新しいチャットのときだけ Composer の上に出るトレイ（Codex App の「MyComputer · Project」と同じ位置）。" +
          "送信待ちトレイと同じ面に、PC と Project のピッカーを並べる。ピッカーはモデル選択と同じパネル・検索欄・行を使う。" +
          "最初の送信で実行先が決まり、トレイは消える。",
      },
    },
  },
  beforeEach: () => installPreview({ ...previewDefaults, scene: "empty" }),
  render: (args) => (
    <PreviewTheme args={{ ...previewDefaults, scene: "empty" }}>
      <PairingStory
        args={args}
        pageActive={false}
        page={(p) => <NewChat p={p} />}
      />
    </PreviewTheme>
  ),
  args: { allow: true, devices: sampleDevices, hosts: [sampleHome] },
} satisfies Meta<PairingArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "新しいチャット" };
export const NoRemote: Story = {
  name: "接続先のPCなし",
  args: { allow: false, devices: [], hosts: [] },
};

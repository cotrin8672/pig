import type { Meta, StoryObj } from "@storybook/react-vite";
import { remoteDraftKey } from "../../mainview/remote-workspace";
import { useStore } from "../../mainview/store";
import type { RemoteTranscript } from "../../shared/remote-workspace";
import { setStoryRemoteProjectRequests } from "../browser-rpc";
import {
  installPreview,
  type PreviewArgs,
  previewArgTypes,
  previewDefaults,
} from "./fixtures";
import { DesktopPreview, PreviewTheme } from "./Previews";

const host = "storybook-chat-ui";
const project = { id: "preview-project", name: "作業メモ" };
const chat = { chat: "preview-chat", title: "接続先のチャット" };
const view = "preview-view";

const meta = {
  title: "Design System/Screens/RemoteChat",
  parameters: { appPreview: true },
  args: previewDefaults,
  argTypes: previewArgTypes,
  beforeEach: ({ args }) => {
    const restore = installPreview(args);
    const key = remoteDraftKey(host, chat.chat);
    const initial: RemoteTranscript = {
      running: false,
      truncated: false,
      messages: [
        { id: "sample-1", role: "user", text: "変更点を確認してください。" },
        {
          id: "sample-2",
          role: "assistant",
          text: "一覧と入力欄の表示を確認しました。",
        },
      ],
    };
    const clearDraft = () => {
      sessionStorage.removeItem(key);
      for (const item of Object.keys(localStorage))
        if (item.startsWith(`${key}:pending:`)) localStorage.removeItem(item);
    };
    clearDraft();
    const stop = setStoryRemoteProjectRequests({
      remoteWorkspace({ query, id }) {
        if (id === host) {
          if (query.op === "list" && query.project === project.id)
            return { chats: [chat], total: 1 };
          if (query.op === "open" && query.chat === chat.chat)
            return { ...initial, chat: chat.chat, view };
          if (query.op === "read" && query.view === view) return { ...initial };
          if (query.op === "send" && query.view === view) {
            initial.messages = [
              ...initial.messages,
              { id: query.id, role: "user", text: query.text },
            ];
            return { disposition: "started" };
          }
        }
        throw new Error("この操作は見本では利用できません。");
      },
      remoteProjectsSave: () => false,
    });
    useStore.setState({
      page: "remoteChat",
      remoteHosts: [
        { id: host, name: "作業用PC", online: true, projects: [project] },
      ],
      remoteThread: {
        ...chat,
        host,
        hostName: "作業用PC",
        project: project.id,
        projectName: project.name,
        view,
      },
    });
    return () => {
      stop();
      clearDraft();
      restore();
    };
  },
  render: (args) => (
    <PreviewTheme args={args}>
      <DesktopPreview />
    </PreviewTheme>
  ),
} satisfies Meta<PreviewArgs>;
export default meta;

export const States: StoryObj<typeof meta> = { name: "RemoteChat" };

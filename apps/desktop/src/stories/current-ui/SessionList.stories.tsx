import type { Meta } from "@storybook/react-vite";
import { SessionList } from "../../mainview/SessionList";
import { useStore } from "../../mainview/store";
import { TooltipLayer } from "../../mainview/Tooltip";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { installPreview, previewDefaults } from "./fixtures";

export default {
  title: "Design System/Domain/SessionList",
  component: SessionList,
  parameters: { gallery: true },
  beforeEach: () => {
    const cleanup = installPreview(previewDefaults);
    useStore.setState((state) => {
      const info = state.snapshots[state.active ?? ""].info;
      const { cwd } = info;
      const archive = { ...info, id: "list-archived", title: "以前のレビュー" };
      return {
        sessions: {
          ...state.sessions,
          [cwd]: [
            info,
            ...[
              "テスト結果",
              "修正の確認",
              "作業メモ",
              "仕様の整理",
              "調査の結果",
              "最初の相談",
            ].map((title, index) => ({
              ...info,
              title,
              id: `list-recent-${index}`,
              modified: info.modified - (index + 1) * 60000,
            })),
            archive,
          ],
        },
        bootstrap: {
          ...state.bootstrap,
          desktop: {
            ...state.bootstrap.desktop,
            sessions: {
              [info.id]: { pinned: true },
              [archive.id]: { archived: true },
            },
          },
        },
      };
    });
    return cleanup;
  },
} satisfies Meta<typeof SessionList>;

export const States = {
  name: "SessionList",
  render: () => {
    const { active, snapshots } = useStore.getState();
    return (
      <PrimitiveSpecimen
        layer="Domain"
        title="SessionList"
        intro="チャット行をピン留めと更新順で並べます。「…」で古い行を展開し、アーカイブ一覧にも切り替えられます。"
        context="サイドバーのチャット一覧"
      >
        <TooltipLayer>
          <SessionList cwd={snapshots[active ?? ""].info.cwd} />
        </TooltipLayer>
      </PrimitiveSpecimen>
    );
  },
};

import type { Meta } from "@storybook/react-vite";
import { Bot, ListChecks, TriangleAlert } from "lucide-react";
import { ComposerCountButton } from "../../mainview/ComposerCountButton";
import { useComposerPopover } from "../../mainview/useComposerPopover";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";
import "../../mainview/session-indicators.css";

export default {
  title: "Design System/Domain/ComposerCountButton",
  component: ComposerCountButton,
  parameters: { gallery: true },
} satisfies Meta<typeof ComposerCountButton>;

function CounterExample() {
  const { shown, trigger, panel } = useComposerPopover(["todo"], 360);
  return (
    <div className="composer">
      <ComposerCountButton
        {...trigger("todo")}
        aria-label="作業の進捗：3件中2件完了"
        icon={ListChecks}
        count="2/3"
      />
      <div
        {...panel}
        className="session-indicator-panel"
        role="dialog"
        aria-label="作業の進捗"
      >
        {shown && "確認待ちの作業が1件あります。"}
      </div>
    </div>
  );
}

export const States = {
  name: "ComposerCountButton",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      title="ComposerCountButton"
      intro="Composerの操作列に件数を表示し、押すと内訳を開きます。"
      context="作業の進捗"
      variants={[
        {
          label: "通常",
          sample: (
            <ComposerCountButton icon={Bot} count={1} aria-label="実行：1件" />
          ),
        },
        {
          label: "実行中",
          sample: (
            <ComposerCountButton
              icon={Bot}
              count={1}
              live
              aria-label="実行中：1件"
            />
          ),
        },
        {
          label: "警告",
          sample: (
            <ComposerCountButton
              icon={TriangleAlert}
              count={2}
              warning
              aria-label="警告：2件"
            />
          ),
        },
      ]}
    >
      <CounterExample />
    </PrimitiveSpecimen>
  ),
};

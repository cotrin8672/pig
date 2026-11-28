import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ThinkingBlock, WorkToggle } from "../../mainview/ToolBlock";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Activity/WorkToggle",
  component: WorkToggle,
  parameters: { gallery: true },
} satisfies Meta<typeof WorkToggle>;

function Work({
  expanded = false,
  tools = 0,
}: {
  expanded?: boolean;
  tools?: number;
}) {
  const [open, setOpen] = useState(expanded);
  return (
    <StoryTurn>
      <WorkToggle open={open} tools={tools} onToggle={() => setOpen(!open)} />
      {open && (
        <ThinkingBlock
          active={false}
          label="思考"
          text={designData.reasoning}
        />
      )}
    </StoryTurn>
  );
}

export const States = {
  name: "WorkToggle",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="WorkToggle"
      intro="確定した回答の前に行われた作業を開閉します。"
      context="折り畳まれた作業"
      variants={[
        { label: "展開状態", sample: <Work expanded tools={2} /> },
        { label: "ツール呼び出しなし", sample: <Work /> },
      ]}
    >
      <Work tools={2} />
    </PrimitiveSpecimen>
  ),
};

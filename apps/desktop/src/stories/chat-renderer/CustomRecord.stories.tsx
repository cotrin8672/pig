import type { Meta } from "@storybook/react-vite";
import { CustomRecord } from "../../mainview/CustomRecord";
import type { TranscriptRecord } from "../../shared/transcript";
import { PrimitiveSpecimen } from "../design-system/PrimitiveSpecimen";
import { StoryTurn } from "../StoryTurn";
import { designData } from "./response-data";

export default {
  title: "ChatRenderer/Extensions/CustomRecord",
  component: CustomRecord,
  parameters: { gallery: true },
} satisfies Meta<typeof CustomRecord>;

const saved = {
  id: "review",
  entryId: "review",
  branchId: "preview",
  parentId: null,
  order: 0,
  kind: "custom-entry",
  customType: "review.checkpoint",
  data: designData.record,
} satisfies TranscriptRecord;

const draw = (record: TranscriptRecord) => (
  <StoryTurn>
    <CustomRecord record={record} />
  </StoryTurn>
);

export const States = {
  name: "CustomRecord",
  render: () => (
    <PrimitiveSpecimen
      layer="ChatRenderer"
      title="CustomRecord"
      intro="専用表示を持たない拡張の記録を、詳細を開ける形で表示します。"
      context="保存された拡張の記録"
      variants={[
        {
          label: "詳細データなし",
          sample: draw({ ...saved, customType: "review.finished", data: null }),
        },
      ]}
    >
      {draw(saved)}
    </PrimitiveSpecimen>
  ),
};

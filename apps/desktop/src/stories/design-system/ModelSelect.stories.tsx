import type { Meta } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { ModelSelect } from "../../mainview/UtilityModelSettings";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Domain/ModelSelect",
  component: ModelSelect,
  parameters: { gallery: true },
} satisfies Meta<typeof ModelSelect>;

type ModelSelectProps = ComponentProps<typeof ModelSelect>;
const models = [
  { provider: "OpenAI", id: "gpt-5", name: "GPT-5" },
  { provider: "Anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
];

function ModelExample({
  initial = null,
  options = models,
}: {
  initial?: ModelSelectProps["value"];
  options?: ModelSelectProps["models"];
}) {
  const [value, setValue] = useState(initial);
  return (
    <ModelSelect
      label="使用するモデル"
      emptyLabel="指定しない"
      models={options}
      value={value}
      onChange={setValue}
    />
  );
}

export const States = {
  name: "ModelSelect",
  render: () => (
    <PrimitiveSpecimen
      layer="Domain"
      wide
      title="ModelSelect"
      intro="設定ごとに使うモデルを検索・選択します。保存済みのモデルが使えないときも選択内容を表示します。"
      context="既定モデルの設定"
      variants={[
        {
          label: "保存済みのモデルが利用不可",
          sample: (
            <ModelExample initial={{ provider: "OpenAI", id: "gpt-4" }} />
          ),
        },
        {
          label: "接続済みのモデルなし",
          sample: <ModelExample options={[]} />,
        },
      ]}
    >
      <ModelExample initial={models[0]} />
    </PrimitiveSpecimen>
  ),
};

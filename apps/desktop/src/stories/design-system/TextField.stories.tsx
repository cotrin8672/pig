import type { Meta } from "@storybook/react-vite";
import { TextField } from "../../mainview/primitives/TextField";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/TextField",
  component: TextField,
  parameters: { gallery: true },
} satisfies Meta<typeof TextField>;
export const States = {
  name: "TextField",
  render: () => (
    <PrimitiveSpecimen
      title="TextField"
      intro="1行の文字列を入力します。"
      context="履歴検索"
      variants={[
        {
          label: "空欄",
          sample: <TextField aria-label="空欄" placeholder="検索…" />,
        },
        {
          label: "入力済み",
          sample: <TextField aria-label="入力済み" defaultValue="会話" />,
        },
        {
          label: "読み取り専用",
          sample: (
            <TextField aria-label="読み取り専用" defaultValue="会話" readOnly />
          ),
        },
        {
          label: "無効",
          sample: <TextField aria-label="無効" placeholder="検索…" disabled />,
        },
      ]}
    >
      <label>
        会話を検索
        <TextField placeholder="タイトルを入力…" />
      </label>
    </PrimitiveSpecimen>
  ),
};

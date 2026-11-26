import type { Meta } from "@storybook/react-vite";
import { Zap } from "lucide-react";
import { useState } from "react";
import { SearchField } from "../../mainview/primitives/SearchField";
import { PrimitiveSpecimen } from "./PrimitiveSpecimen";

export default {
  title: "Design System/Primitives/SearchField",
  component: SearchField,
  parameters: { gallery: true },
} satisfies Meta<typeof SearchField>;

export const States = {
  name: "SearchField",
  render: function Example() {
    const [query, setQuery] = useState("claude");
    return (
      <PrimitiveSpecimen
        title="SearchField"
        intro="一覧を絞り込む検索欄です。単独で置く枠付きと、Popoverや一覧の見出しに置く枠なしがあります。"
        context="パッケージ検索"
        variants={[
          {
            label: "枠付き・空",
            sample: <SearchField aria-label="空" placeholder="検索" />,
          },
          {
            label: "入力あり・消去",
            sample: (
              <SearchField
                aria-label="入力あり"
                value="gpt"
                onChange={() => {}}
                onClear={() => {}}
                clearLabel="検索を消去"
              />
            ),
          },
          {
            label: "枠なし・操作付き",
            sample: (
              <SearchField
                variant="inline"
                aria-label="枠なし"
                placeholder="モデルを検索"
              >
                <button type="button" aria-label="高速モード" aria-pressed>
                  <Zap size={14} />
                </button>
              </SearchField>
            ),
          },
          {
            label: "無効",
            sample: (
              <SearchField aria-label="無効" placeholder="検索" disabled />
            ),
          },
        ]}
      >
        <SearchField
          aria-label="パッケージを検索"
          placeholder="パッケージを検索…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          clearLabel="検索を消去"
        />
      </PrimitiveSpecimen>
    );
  },
};

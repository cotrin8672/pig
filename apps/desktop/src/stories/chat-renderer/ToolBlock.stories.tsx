import type { Meta } from "@storybook/react-vite";
import { ToolBlock } from "../../mainview/ToolBlock";
import { ToolSpecimen } from "./ToolSpecimen";
import {
  bash,
  card,
  edit,
  find,
  grep,
  lookup,
  ls,
  powershell,
  read,
  write,
} from "./tool-data";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Tools/ToolBlock",
  component: ToolBlock,
  parameters: { gallery: true },
} satisfies Meta<typeof ToolBlock>;

const grepResult = (text: string) => ({
  ...grep.tool,
  state: {
    status: "done" as const,
    result: { content: [{ type: "text", text }] },
  },
});

export const States = {
  name: "ToolBlock",
  render: () => (
    <ToolSpecimen
      title="ToolBlock"
      intro="ツールの種類・状態に応じて、会話内に実行内容と結果を表示します。"
      example={bash.tool}
      variants={[
        { label: "Bash：実行中", tool: atPhase(bash, "running") },
        { label: "Bash：失敗", tool: atPhase(bash, "error") },
        { label: "PowerShell：実行結果", tool: powershell.tool },
        { label: "Read：ファイル本文", tool: read.tool },
        { label: "Write：書き込み内容", tool: write.tool },
        { label: "Edit：ファイル差分", tool: edit.tool },
        { label: "Grep：ファイル別の一致", tool: grep.tool },
        {
          label: "Grep：前後行と上限通知",
          tool: grepResult(
            [
              "src/app.ts-2- // Set the header",
              'src/app.ts:3: import { greeting } from "./i18n/greeting";',
              "src/app.ts-4- const name = 'Mina';",
              "[1 matches limit reached. Use limit=4 for more.]",
            ].join("\n"),
          ),
        },
        { label: "Grep：一致なし", tool: grepResult("No matches found") },
        {
          label: "Grep：長いファイル名・出力",
          tool: grepResult(
            Array.from(
              { length: 20 },
              (_, index) =>
                `src/components/navigation/deeply/nested/Header.tsx:${index + 1}: const label = greeting(locale, "${"long value ".repeat(12)}");`,
            ).join("\n"),
          ),
        },
        { label: "Find：ファイル検索", tool: find.tool },
        { label: "List：ディレクトリ一覧", tool: ls.tool },
        { label: "拡張ツール：組み込み専用表示がない場合", tool: lookup.tool },
        { label: "設定で指定したツールカード", tool: card.tool },
      ]}
    />
  ),
};

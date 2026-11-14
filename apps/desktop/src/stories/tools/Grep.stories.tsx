import { grep } from "../proposals/data";
import {
  atPhase,
  type Phase,
  phaseControls,
  toolStories,
} from "../proposals/kit";
import { grepProposals } from "../proposals/tools";
import { GrepPreview } from "./GrepPreview";

export default { title: "Chat/Tools/Grep", ...phaseControls };
const stories = toolStories(grep, {
  AlignedGroups: {
    title: "ファイル別の一致行（既存UIに統一）",
    fit: "01のファイル別表示を、Edit・Listと共通の見出し・開閉・本文枠に揃えた案。全体を約8行でプレビューし、残りは枠内スクロール。",
    View: ({ tool }) => <GrepPreview data={tool} />,
  },
  ...grepProposals,
});
export const Default = stories.Default;
export const AlignedGroups = stories.AlignedGroups;
export const Compare = stories.Compare;
export const Groups = stories.Groups;
export const Distribution = stories.Distribution;
export const Sentence = stories.Sentence;

function result(text: string, phase: Phase = "done") {
  const tool = atPhase(grep, phase);
  return phase === "done"
    ? {
        ...tool,
        state: {
          status: "done" as const,
          result: { content: [{ type: "text" as const, text }] },
        },
      }
    : tool;
}

export const NoMatches = {
  name: "統一案 / 一致なし",
  render: ({ phase }: { phase: Phase }) => (
    <GrepPreview data={result("No matches found", phase)} />
  ),
};

export const Context = {
  name: "統一案 / 前後行と上限通知",
  render: ({ phase }: { phase: Phase }) => (
    <GrepPreview
      data={result(
        [
          "src/app.ts-2- // Set the header",
          'src/app.ts:3: import { greeting } from "./i18n/greeting";',
          "src/app.ts-4- const user = getUser();",
          "--",
          "src/app.ts-17- if (user) {",
          "src/app.ts:18:   header.textContent = greeting(user.locale, user.name);",
          "src/app.ts-19- }",
          "[2 matches limit reached. Use limit=4 for more.]",
        ].join("\n"),
        phase,
      )}
    />
  ),
};

export const Narrow = {
  name: "統一案 / 狭い幅・長い出力",
  render: ({ phase }: { phase: Phase }) => (
    <div style={{ width: "100%", maxWidth: 360 }}>
      <GrepPreview
        data={result(
          Array.from(
            { length: 24 },
            (_, index) =>
              `src/components/navigation/deeply/nested/Header.tsx:${index + 1}:   const text${index} = greeting(user.locale, user.name, { fallback: "${"long value ".repeat(12)}" });`,
          ).join("\n"),
          phase,
        )}
      />
    </div>
  ),
};

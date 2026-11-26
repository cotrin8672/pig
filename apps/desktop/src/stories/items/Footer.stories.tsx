import { ResponseFooter } from "../../mainview/ResponseFooter";
import { TooltipLayer } from "../../mainview/Tooltip";
import { FooterDefault, footerProposals } from "../proposals/content";
import { stats } from "../proposals/data";
import { contentStories } from "../proposals/kit";

export default { title: "Chat/Activity/Response footer" };
const stories = contentStories(footerProposals, FooterDefault);
export const Default = stories.Default;

const files = [
  { path: "chat/Composer.tsx", added: 24, removed: 5 },
  { path: "chat/queue.ts", added: 12, removed: 4 },
  { path: "docs/queue.md", added: 6, removed: 0 },
];
const samples = [
  { label: "3ファイル", files },
  {
    label: "6ファイル（先頭4件＋残り）",
    files: [
      ...files,
      {
        path: "chat/extensions/composer/keyboard-shortcuts/CommandSuggestionPanel.tsx",
        added: 5,
        removed: 2,
      },
      { path: "chat/queue.test.ts", added: 3, removed: 0 },
      { path: "chat/legacy-queue.ts", added: 0, removed: 2 },
    ],
  },
  { label: "変更なし", files: undefined },
];

export const Files = {
  name: "変更ファイル",
  render: () => (
    <TooltipLayer>
      {samples.map((sample) => (
        <section key={sample.label} className="pp-specimen">
          <header>
            <strong>{sample.label}</strong>
          </header>
          <ResponseFooter
            sessionId="preview"
            canRegenerate={false}
            stats={{ ...stats, files: sample.files }}
          />
        </section>
      ))}
    </TooltipLayer>
  ),
};

export const Compare = stories.Compare;
export const Line = stories.Line;
export const Hover = stories.Hover;
export const Time = stories.Time;

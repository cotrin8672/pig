import type { Meta } from "@storybook/react-vite";
import { ApplyPatchRenderer } from "../../mainview/ApplyPatchRenderer";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase, type ToolFixture } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/ApplyPatchRenderer",
  component: ApplyPatchRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof ApplyPatchRenderer>;

const patch = [
  "*** Begin Patch",
  "*** Update File: src/i18n/greeting.ts",
  "@@ export function greeting(locale: Locale, name?: string) {",
  "-  const template = templates[locale] ?? templates.en;",
  "+  const template = templates[locale] ?? templates[fallbackLocale];",
  "   if (!name) return template.anonymous;",
  "@@ const templates: Record<Locale, Template> = {",
  '-  en: { anonymous: "Hello!", named: "Hello, {name}!", farewell: "Bye" },',
  '+  en: { anonymous: "Hello!", named: "Hello, {name}!", farewell: "Goodbye" },',
  "+  fr,",
  '   ja: { anonymous: "こんにちは", named: "こんにちは、{name}さん", farewell: "またね" },',
  "*** Add File: src/i18n/locales/fr.ts",
  '+import type { Template } from "../types";',
  "+",
  "+export const fr: Template = {",
  '+  anonymous: "Bonjour !",',
  '+  named: "Bonjour, {name} !",',
  '+  farewell: "Au revoir",',
  "+};",
  "*** Update File: src/i18n/format.ts",
  "*** Move to: src/i18n/legacy-format.ts",
  "@@",
  "-export const VERSION = 1;",
  "+export const VERSION = 2;",
  "*** Delete File: src/i18n/old-greeting.ts",
  "*** End Patch",
].join("\n");

const fixture = (text: string): ToolFixture => ({
  tool: {
    call: {
      id: "apply_patch",
      name: "apply_patch",
      arguments: { patch: text },
    },
    live: false,
    state: {
      status: "done",
      result: { content: [{ type: "text", text: "Applied patch" }] },
    },
  },
  error:
    "Failed to find expected lines in src/i18n/greeting.ts:\n  const template = templates[locale] ?? templates.en;",
});

export const States = {
  name: "ApplyPatchRenderer",
  render: () => (
    <ToolSpecimen
      title="ApplyPatchRenderer"
      intro="パッチが変更・追加・移動・削除するファイルと、その差分を表示します。"
      example={fixture(patch).tool}
      renderer={ApplyPatchRenderer}
      variants={[
        {
          label: "単一ファイル",
          tool: fixture(patch.split("*** Add File")[0]).tool,
        },
        {
          label: "受信中",
          tool: atPhase(
            fixture(patch.slice(0, patch.indexOf("+export const fr"))),
            "running",
          ),
        },
        { label: "適用失敗", tool: atPhase(fixture(patch), "error") },
      ]}
    />
  ),
};

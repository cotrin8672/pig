import { ApplyPatchRenderer } from "../../../../mainview/ApplyPatchRenderer";
import { DisclosureScope } from "../../../../mainview/LazyDetails";
import {
  atPhase,
  type Phase,
  phaseControls,
  type Tool,
  type ToolFixture,
} from "../../../proposals/kit";

export default {
  title: "Chat/Tools/Extensions/pi-codex-tools/apply_patch",
  ...phaseControls,
};

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

const View = ({ tool }: { tool: Tool }) => (
  <DisclosureScope id={`story:${tool.call.id}`}>
    <ApplyPatchRenderer data={tool} DefaultRenderer={() => null} />
  </DisclosureScope>
);

export const Default = {
  render: ({ phase }: { phase: Phase }) => (
    <View tool={atPhase(fixture(patch), phase)} />
  ),
};

export const SingleFile = {
  name: "1ファイル",
  render: ({ phase }: { phase: Phase }) => (
    <View tool={atPhase(fixture(patch.split("*** Add File")[0]), phase)} />
  ),
};

/** The patch argument streams in; cards appear as each file arrives. */
export const Streaming = {
  name: "受信途中",
  render: () => (
    <View
      tool={{
        ...atPhase(
          fixture(patch.slice(0, patch.indexOf("+export const fr"))),
          "running",
        ),
      }}
    />
  ),
};

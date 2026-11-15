import type { ComponentType } from "react";
import {
  atPhase,
  type Phase,
  type Tool,
  type ToolFixture,
  type ToolProps,
} from "../../../proposals/kit";
import {
  activateTools,
  astOutline,
  astReplace,
  astSearch,
  diagnosticMark,
  effectiveConfig,
  lensDiagnostics,
  lspNavigation,
  moduleReport,
  projectReport,
  readEnclosing,
  readSymbol,
  symbolSearch,
} from "../../../proposals/lens-data";
import { familyProposals } from "../../../proposals/lens-family";
import { Builtin } from "../../../proposals/lens-kit";
import { richProposals } from "../../../proposals/lens-rich";

/*
 * One pi-lens theme, five presentation philosophies. Each variant renders every
 * pi-lens tool, so consistency is judged across the family, not tool by tool.
 */

/* Built-in neighbours, kept local: proposals/data imports an image the UI fixture cannot load. */
const builtin = (
  name: string,
  args: Record<string, unknown>,
  text: string,
): ToolFixture => ({
  tool: {
    call: { id: `builtin-${name}`, name, arguments: args },
    live: false,
    state: { status: "done", result: { content: [{ type: "text", text }] } },
  } satisfies Tool,
  error: "",
});
const read = builtin(
  "read",
  { path: "src/i18n/greeting.ts", offset: 12, limit: 5 },
  "export function greeting(locale: Locale, name?: string) {\n  const template = templates[locale] ?? templates.en;\n}",
);
const grep = builtin(
  "grep",
  { pattern: "greeting", path: "src", glob: "*.ts" },
  'src/i18n/greeting.ts:12: export function greeting(locale: Locale, name?: string) {\nsrc/app.ts:3: import { greeting } from "./i18n/greeting";',
);
const bash = builtin(
  "bash",
  { command: "pnpm test --filter greeting" },
  " ✓ src/i18n/greeting.test.ts (6 tests) 12ms\n\n Test Files  1 passed (1)",
);

const lens: Record<string, ToolFixture> = {
  pi_lens_activate_tools: activateTools,
  project_report: projectReport,
  symbol_search: symbolSearch,
  module_report: moduleReport,
  ast_grep_outline: astOutline,
  read_symbol: readSymbol,
  lsp_navigation: lspNavigation,
  ast_grep_search: astSearch,
  ast_grep_replace: astReplace,
  lens_diagnostics: lensDiagnostics,
  read_enclosing: readEnclosing,
  lens_diagnostic_mark: diagnosticMark,
  effective_config: effectiveConfig,
};
/** A plausible session order, with built-in tools mixed in to judge recognisability. */
const session: [ToolFixture, boolean][] = [
  [activateTools, true],
  [projectReport, true],
  [symbolSearch, true],
  [read, false],
  [moduleReport, true],
  [astOutline, true],
  [readSymbol, true],
  [lspNavigation, true],
  [grep, false],
  [astSearch, true],
  [astReplace, true],
  [bash, false],
  [lensDiagnostics, true],
  [readEnclosing, true],
  [diagnosticMark, true],
  [effectiveConfig, true],
];

type Args = { phase?: Phase; tool?: string };
export default {
  title: "Chat/Tools/Extensions/pi-lens/Families",
  args: { phase: "done" as Phase, tool: "lens_diagnostics" },
  argTypes: {
    phase: {
      control: "inline-radio" as const,
      options: ["done", "running", "error"],
    },
    tool: { control: "select" as const, options: Object.keys(lens) },
  },
};

function Transcript({
  View,
  phase = "done",
}: {
  View: ComponentType<ToolProps>;
  phase?: Phase;
}) {
  return (
    <div className="pp-compare">
      {session.map(([fixture, isLens]) =>
        isLens ? (
          <View
            key={fixture.tool.call.id}
            tool={atPhase(fixture, phase)}
            phase={phase}
          />
        ) : (
          <Builtin
            key={fixture.tool.call.id}
            tool={fixture.tool}
            phase="done"
          />
        ),
      )}
    </div>
  );
}

const all = { ...familyProposals, ...richProposals };
const transcript =
  (key: keyof typeof all) =>
  ({ phase }: Args) => {
    const { title, fit, View } = all[key];
    return (
      <section className="pp-specimen">
        <header>
          <span>pi-lens</span>
          <strong>{title}</strong>
          <p>{fit}</p>
        </header>
        <Transcript View={View} phase={phase} />
      </section>
    );
  };

export const Quiet = { name: "控えめ", render: transcript("quiet") };
export const Signed = { name: "署名", render: transcript("signed") };
export const Verdict = { name: "結論先行", render: transcript("verdict") };
export const Navigator = { name: "位置中心", render: transcript("navigator") };
export const CodeFirst = { name: "コード中心", render: transcript("code") };

/* Rich families: the same theme drawn as pictures instead of rows. */
export const Minimap = { name: "ミニマップ", render: transcript("minimap") };
export const Graph = { name: "関係図", render: transcript("graph") };
export const GraphCompact = {
  name: "関係図（コンパクト）",
  render: transcript("graphCompact"),
};
export const Gauge = { name: "計器", render: transcript("gauge") };
export const Split = { name: "分割ビュー", render: transcript("split") };
export const Treemap = { name: "ツリーマップ", render: transcript("treemap") };

/** One tool across every family; pick the tool from the controls. */
export const ByTool = {
  name: "ツール別に比較",
  render: ({ phase = "done", tool = "lens_diagnostics" }: Args) => {
    const fixture = lens[tool] ?? lensDiagnostics;
    return (
      <div className="pp-compare">
        {fixture.description && (
          <section className="pp-tool-description">
            <h2>{fixture.tool.call.name}</h2>
            <p>{fixture.description.purpose}</p>
            <dl>
              <dt>入力</dt>
              <dd>{fixture.description.input}</dd>
              <dt>出力</dt>
              <dd>{fixture.description.output}</dd>
            </dl>
          </section>
        )}
        {Object.values(all).map(({ title, fit, View }, index) => (
          <section key={title} className="pp-specimen">
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{fit}</p>
            </header>
            <View tool={atPhase(fixture, phase)} phase={phase} />
          </section>
        ))}
      </div>
    );
  },
};

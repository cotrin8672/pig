import type { Meta } from "@storybook/react-vite";
import { PiLensRenderer } from "../../mainview/PiLensRenderer";
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
} from "./lens-data";
import { ToolSpecimen } from "./ToolSpecimen";
import { atPhase } from "./tool-fixture";

export default {
  title: "ChatRenderer/Extensions/PiLensRenderer",
  component: PiLensRenderer,
  parameters: { gallery: true },
} satisfies Meta<typeof PiLensRenderer>;

const results = [
  readEnclosing,
  symbolSearch,
  astSearch,
  astReplace,
  astOutline,
  lspNavigation,
  lensDiagnostics,
  diagnosticMark,
  moduleReport,
  projectReport,
  effectiveConfig,
  activateTools,
];

export const States = {
  name: "PiLensRenderer",
  render: () => (
    <ToolSpecimen
      title="PiLensRenderer"
      intro="pi-lens のコード探索・診断の結果を、関連の流れや本文として表示します。"
      example={readSymbol.tool}
      renderer={PiLensRenderer}
      variants={[
        ...results.map(({ tool }) => ({ label: tool.call.name, tool })),
        { label: "読み取り中", tool: atPhase(readSymbol, "running") },
        { label: "読み取り失敗", tool: atPhase(readSymbol, "error") },
      ]}
    />
  ),
};

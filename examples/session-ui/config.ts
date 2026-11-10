// Repository-relative for this example's typecheck. In your own config use:
// import { defineConfig } from "@pig/config";
import { defineConfig } from "../../packages/config/src";
import {
  connectPiPlanMode,
  connectPiSubagents,
  connectPiTodos,
} from "./pi-adapters";

// EDIT: use the exact sourceInfo.path of your loaded official plan-mode extension.
// This placeholder intentionally matches nothing: saved mode/steps remain readable,
// but no toggle command/action is registered until the exact source is available.
const planModeSource = "/replace/with/your/loaded/plan-mode/index.ts";

export default defineConfig({
  apiVersion: 1,
  sessionAdapters: [
    connectPiTodos(),
    connectPiPlanMode({ source: planModeSource }),
    connectPiSubagents(),
  ],
});

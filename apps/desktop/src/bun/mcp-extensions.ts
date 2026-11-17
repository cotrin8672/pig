import type { McpApps } from "./mcp-apps";
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
} from "./sdk";

/** Standard SDK built-ins; installed replacements and -builtin:* settings still win. */
export function desktopMcpExtensions(apps: McpApps) {
  return [
    {
      name: "mcp",
      builtin: true as const,
      replaceable: true,
      factory: createMcpExtension({ onToolResult: apps.observe }),
    },
    {
      name: "codemode",
      builtin: true as const,
      replaceable: true,
      factory: createCodemodeExtension(),
    },
    {
      name: "tool_search",
      builtin: true as const,
      replaceable: true,
      factory: createToolSearchExtension(),
    },
  ];
}

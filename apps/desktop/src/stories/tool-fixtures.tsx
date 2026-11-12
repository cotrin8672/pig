import type { ChatRenderData } from "@pig/chat-renderers";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolBlock, ToolGroup } from "../mainview/ToolBlock";

type Tool = ChatRenderData["tool"];
const meta = { title: "Chat/Tools", component: ToolBlock } satisfies Meta<
  typeof ToolBlock
>;
export default meta;
type Story = StoryObj<typeof meta>;
const path = "src/greeting.ts";
const code = 'export const greeting = "Hello, world!";';
const diff = `-export const greeting = "Hi";\n+${code}`;
function tool(
  name: string,
  args: Tool["call"]["arguments"],
  output: string,
  overrides: Partial<Tool> = {},
): Story {
  return {
    args: {
      call: { id: name, name, arguments: args },
      live: false,
      state: {
        status: "done",
        result: { content: [{ type: "text", text: output }] },
      },
      ...overrides,
    },
  };
}
export const Read = tool("read", { path, offset: 1, limit: 3 }, code);
export const Grep = tool(
  "grep",
  { pattern: "greeting", path: "src", glob: "*.ts" },
  `${path}:1:${code}`,
);
export const Find = tool("find", { pattern: "*.ts", path: "src" }, path);
export const Ls = tool("ls", { path: "src" }, "greeting.ts\nindex.ts");
export const Edit = tool("edit", { path }, "", {
  state: { status: "done", result: { details: { diff } } },
});
export const Write = tool("write", { path, content: code }, "");
export const Bash = tool(
  "bash",
  { command: "pnpm test" },
  "Running tests…\n3 passed\n0 failed",
);
export const AnsiBash = tool(
  "bash",
  { command: "pnpm test" },
  "\u001b[1;32m✓ Tests passed\u001b[0m\n\u001b[33mWarning: deprecated option\u001b[0m\n\u001b[38;2;136;192;208m3 passed, 0 failed\u001b[0m",
);
export const Powershell = tool(
  "powershell",
  { command: "Get-Location" },
  "C:\\project",
);
export const Running = tool("bash", { command: "pnpm test" }, "", {
  live: true,
  state: undefined,
});
export const Failed = tool("bash", { command: "pnpm test" }, "", {
  state: {
    status: "error",
    result: {
      content: [
        {
          type: "text",
          text: "One assertion failed\nCommand exited with code 1",
        },
      ],
    },
  },
});
export const Generic = tool(
  "lookup",
  { symbol: "greeting" },
  "Exported constant",
);
export const ConfiguredCard = tool("review", {}, "", {
  card: {
    title: "Review",
    target: path,
    meta: "1 file",
    body: [
      { type: "text", text: "Checked the greeting." },
      {
        type: "text",
        format: "markdown",
        text: "**Result:** ready for review.",
      },
      { type: "code", text: code },
      { type: "diff", text: diff },
      { type: "terminal", text: "$ pnpm test\n3 passed" },
      { type: "facts", items: [{ label: "Files changed", value: "1" }] },
      {
        type: "list",
        items: [{ title: "Tests", description: "All checks passed" }],
      },
    ],
  },
});
export const ExploreGroup = () => (
  <ToolGroup
    calls={["ls", "read"].map((name) => ({
      type: "toolCall",
      id: name,
      name,
      arguments: { path: name === "ls" ? "src" : path },
    }))}
    tools={{
      ls: {
        status: "done",
        result: { content: [{ type: "text", text: "greeting.ts" }] },
      },
      read: {
        status: "done",
        result: { content: [{ type: "text", text: code }] },
      },
    }}
    live={false}
  />
);

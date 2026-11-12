import type { ChatRenderData } from "@pig/chat-renderers";
import { resultText } from "../shared/tool-view";

/** Fixture results are plain path:line:text matches or newline-delimited paths. */
export function searchRows(tool: ChatRenderData["tool"]) {
  const args = tool.call.arguments as Record<string, unknown>;
  return resultText(tool.state?.result)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match =
        tool.call.name === "grep" ? /^(.*?):(\d+):(.*)$/.exec(line) : null;
      return match
        ? { path: match[1], line: match[2], text: match[3] }
        : {
            path: tool.call.name === "ls" ? `${args.path}/${line}` : line,
            line: "",
            text: "",
          };
    });
}

/** These proposals use the same small +/- preview diff as the built-in fixture. */
export function revisionViews(diff: string) {
  const lines = diff.split("\n");
  return {
    lines,
    before: lines
      .filter((line) => !line.startsWith("+"))
      .map((line) => line.replace(/^[- ]/, ""))
      .join("\n"),
    after: lines
      .filter((line) => !line.startsWith("-"))
      .map((line) => line.replace(/^[+ ]/, ""))
      .join("\n"),
    added: lines.filter((line) => line.startsWith("+")).length,
    removed: lines.filter((line) => line.startsWith("-")).length,
  };
}

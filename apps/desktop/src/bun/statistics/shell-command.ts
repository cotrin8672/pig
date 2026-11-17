export function isShellTool(tool: string): tool is "bash" | "powershell" {
  return tool === "bash" || tool === "powershell";
}

// shortcut: only recognize a shared subset of simple shell syntax; add cases when coverage warrants it.
const simpleCommand =
  /^[ \t]*[A-Za-z-]+(?:[ \t]+(?:[\w./:=+,-]+|'[^']*'|"[^"$`\\]*"))*[ \t]*$/u;

export function classifyShellCommand(
  shell: "bash" | "powershell",
  command: unknown,
) {
  if (
    typeof command !== "string" ||
    command.length > 4096 ||
    command.includes("\0") ||
    /[\r\n\u2028\u2029\u2018-\u201f]/u.test(command) ||
    !simpleCommand.test(command)
  )
    return "unclassified";

  const [name, subcommand] = command.trim().split(/[ \t]+/, 2);
  const verb = shell === "powershell" ? name.toLowerCase() : name;
  if (verb === "rg") return "rg";
  if (verb === "git" && subcommand === "status") return "git status";
  if (verb === "git" && subcommand === "diff") return "git diff";
  if (verb === "pnpm" && subcommand === "test") return "pnpm test";
  if (shell === "powershell" && verb === "get-childitem")
    return "Get-ChildItem";
  return "unclassified";
}

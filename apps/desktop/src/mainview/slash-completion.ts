import type { RPCSchema, SlashCommand } from "../shared/rpc-schema";

export type SlashArgument =
  RPCSchema["bun"]["requests"]["completeSlashArguments"]["response"][number];

/** Complete only the leading command line, preserving text after the cursor. */
export function slashContext(text: string, start: number, end: number) {
  if (start !== end || start > text.length) return undefined;
  const before = text.slice(0, start);
  const match = /^\/([^\s/]*)(?:[ \t]+([^\n]*))?$/.exec(before);
  if (!match) return undefined;
  if (match[2] === undefined) {
    const suffix = /^[^\s]*/.exec(text.slice(start))?.[0] ?? "";
    return {
      kind: "command" as const,
      prefix: match[1],
      start: 0,
      end: start + suffix.length,
    };
  }
  const argumentStart = before.length - match[2].length;
  return {
    kind: "argument" as const,
    name: match[1],
    prefix: match[2],
    start: argumentStart,
    end: start,
  };
}

export function extensionCommand(text: string, commands: SlashCommand[]) {
  const name = /^\/([^\s/]+)(?:\s|$)/.exec(text)?.[1];
  return (
    !!name &&
    commands.some(
      (command) => command.name === name && command.category === "extension",
    )
  );
}

export function matchesSlashCommand(command: SlashCommand, prefix: string) {
  const query = prefix.toLowerCase();
  return (
    command.name.toLowerCase().includes(query) ||
    (command.description?.toLowerCase().includes(query) ?? false)
  );
}

export function applySlashCompletion(
  text: string,
  context: NonNullable<ReturnType<typeof slashContext>>,
  value: string,
) {
  const replacement =
    value +
    (context.kind === "command" && !/^[ \t]/.test(text.slice(context.end))
      ? " "
      : "");
  return {
    text: text.slice(0, context.start) + replacement + text.slice(context.end),
    cursor: context.start + replacement.length,
  };
}

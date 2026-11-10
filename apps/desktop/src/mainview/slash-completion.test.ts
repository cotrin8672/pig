import { expect, test } from "bun:test";
import {
  applySlashCompletion,
  extensionCommand,
  matchesSlashCommand,
  slashContext,
} from "./slash-completion";

test("only completes the leading slash command at an unselected cursor", () => {
  expect(slashContext("/hello world", 3, 3)).toEqual({
    kind: "command",
    prefix: "he",
    start: 0,
    end: 6,
  });
  expect(slashContext("text /hello", 11, 11)).toBeUndefined();
  expect(slashContext("/hello", 1, 3)).toBeUndefined();
  expect(slashContext("/hello\nworld", 12, 12)).toBeUndefined();
});
test("argument prefix and suffix are scoped to the first line", () => {
  expect(slashContext("/hello foo bar\nnext", 10, 10)).toEqual({
    kind: "argument",
    name: "hello",
    prefix: "foo",
    start: 7,
    end: 10,
  });
});
test("only registered exact extension commands bypass model requirement", () => {
  const commands = [
    { name: "hello", category: "extension" as const },
    { name: "skill", category: "skill" as const },
  ];
  expect(extensionCommand("/hello arg", commands)).toBe(true);
  expect(extensionCommand("/hello2", commands)).toBe(false);
  expect(extensionCommand("/skill", commands)).toBe(false);
});

test("argument value replaces only the prefix, preserving trailing arguments", () => {
  const text = "/hello fo bar\nnext";
  const context = slashContext(text, 9, 9);
  expect(context).toBeDefined();
  if (!context) throw new Error("missing context");
  const option = { label: "Friendly name", value: "foo" };
  expect(applySlashCompletion(text, context, option.value)).toEqual({
    text: "/hello foo bar\nnext",
    cursor: 10,
  });
});

test("matches names and descriptions case-insensitively", () => {
  const command = {
    name: "deploy",
    description: "Publish release",
    category: "extension" as const,
  };
  expect(matchesSlashCommand(command, "PLO")).toBe(true);
  expect(matchesSlashCommand(command, "RELEASE")).toBe(true);
  expect(matchesSlashCommand(command, "missing")).toBe(false);
});

import { expect, test } from "bun:test";
import type { SessionUIState } from "../../../../packages/config/src";
import { adapterBindings } from "./adapter-keymap";

test("adapter keys require matching surface, registered command and idle operation", () => {
  const state: SessionUIState = {
    generation: "g",
    views: [],
    diagnostics: [],
    commands: [{ adapterId: "a", id: "toggle", title: "Toggle", busy: false }],
    keymaps: [
      { adapter: "a", command: "toggle", keys: "Ctrl+P", when: "composer" },
    ],
  };
  expect(adapterBindings(state, "composer")[0]?.command).toBe("toggle");
  expect(adapterBindings(state, "chat")).toEqual([]);
  expect(adapterBindings(state, null)).toEqual([]);
  state.commands[0].busy = true;
  expect(adapterBindings(state, "composer")).toEqual([]);
  state.commands = [];
  expect(adapterBindings(state, "composer")).toEqual([]);
});

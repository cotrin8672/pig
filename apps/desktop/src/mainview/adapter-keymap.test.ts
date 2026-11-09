import { expect, test } from "bun:test";
import type { SessionUIState } from "../../../../packages/config/src";
import { adapterBinding } from "./adapter-keymap";

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
  const event = {
    key: "p",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  };
  expect(adapterBinding(state, event, "composer")?.command).toBe("toggle");
  expect(adapterBinding(state, event, "chat")).toBeUndefined();
  expect(adapterBinding(state, event, null)).toBeUndefined();
  state.commands[0].busy = true;
  expect(adapterBinding(state, event, "composer")).toBeUndefined();
  state.commands = [];
  expect(adapterBinding(state, event, "composer")).toBeUndefined();
});

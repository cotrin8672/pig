import { expect, test } from "bun:test";
import {
  filterModels,
  isModelEnabled,
  modelKey,
  replaceModelVisibility,
} from "./models";

const models = [
  { provider: "openai-codex", id: "shared", name: "GPT Test" },
  { provider: "anthropic", id: "shared", name: "Claude Test" },
];
test("all models enabled by default, including newly added models", () => {
  expect(filterModels(models, [])).toEqual(models);
  expect(isModelEnabled(models[0], ["openai-codex/old-model"])).toBe(true);
});
test("visibility is scoped to provider and model ID", () => {
  expect(filterModels(models, [modelKey(models[0])])).toEqual([models[1]]);
  expect(filterModels(models, models.map(modelKey))).toEqual([]);
});
test("search matches name, ID, and provider case-insensitively", () => {
  expect(filterModels(models, [], "  CLAUDE  ")).toEqual([models[1]]);
  expect(filterModels(models, [], "openai")).toEqual([models[0]]);
  expect(filterModels(models, [], "shared")).toEqual(models);
  expect(filterModels(models, [modelKey(models[1])], "claude")).toEqual([]);
  expect(filterModels(models, [], "missing")).toEqual([]);
});

test("a response only merges the affected models, not stale unrelated choices", () => {
  expect(
    replaceModelVisibility(
      ["anthropic/new-choice", "openai-codex/a"],
      ["openai-codex/a"],
      ["anthropic/stale", "openai-codex/a"],
    ),
  ).toEqual(["anthropic/new-choice", "openai-codex/a"]);
  expect(
    replaceModelVisibility(
      ["anthropic/new-choice", "openai-codex/a"],
      ["openai-codex/a"],
      [],
    ),
  ).toEqual(["anthropic/new-choice"]);
});

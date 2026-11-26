import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import postcss from "postcss";
import { paneGeometry } from "../../mainview/pane-layout";
import { useStore } from "../../mainview/store";
import {
  rpc,
  sends,
  setStoryPreviewActive,
  updateAppearance,
} from "../browser-rpc";
import { createPreviewState, previewDefaults, scenes } from "./fixtures";

test("the shared preview entry does not eagerly import feature UI", () => {
  const path = fileURLToPath(new URL("./Previews.tsx", import.meta.url));
  const ast = parse(readFileSync(path, "utf8"), {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const allowed = new Set([
    "react",
    "lucide-react",
    "../../mainview/dynamic-theme",
    // A leaf primitive (an icon and its keyframes), not feature UI.
    "../../mainview/primitives/Spinner",
    "../../mainview/store",
    "./preview.css",
  ]);
  const lazyExports: string[] = [];
  for (const statement of ast.program.body) {
    if (
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type"
    )
      expect(
        allowed.has(statement.source.value),
        `Unexpected eager dependency: ${statement.source.value}`,
      ).toBe(true);
    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.declaration?.type !== "VariableDeclaration"
    )
      continue;
    for (const variable of statement.declaration.declarations)
      if (
        variable.id.type === "Identifier" &&
        variable.init?.type === "CallExpression" &&
        variable.init.callee.type === "Identifier" &&
        variable.init.callee.name === "lazy"
      )
        lazyExports.push(variable.id.name);
  }
  expect(lazyExports.sort()).toEqual([
    "ActivityPreview",
    "ChatScreenPreview",
    "DesktopPreview",
    "NotificationPreview",
    "SidebarPreview",
  ]);
});

test("whole-screen scenarios use fresh synthetic state without changing the app store", () => {
  const previous = useStore.getState();
  for (const scene of scenes) {
    const state = createPreviewState(
      { ...previewDefaults, scene },
      1700000000000,
    );
    expect(state.initialized).toBe(true);
    expect(state.hostId).toStartWith("storybook-");
    expect(state.snapshots[state.active ?? ""]).toBeDefined();
    expect(
      state.bootstrap.providers.every((provider) => provider.configured),
    ).toBe(true);
    expect(
      Object.values(state.snapshots).every(
        (snapshot) => snapshot.address.hostId === state.hostId,
      ),
    ).toBe(true);
    expect(state.pendingUI.length).toBe(scene === "approval" ? 1 : 0);
    if (scene === "split") {
      const geometry = paneGeometry(state.paneTree);
      expect(geometry.panes).toHaveLength(2);
      expect(
        geometry.panes.every((pane) => pane.bounds.x + pane.bounds.width <= 1),
      ).toBe(true);
    }
  }
  expect(useStore.getState()).toBe(previous);
});

test("the preview host blocks sends and native operations; local selection cannot cross a host", async () => {
  const previous = useStore.getState();
  const state = createPreviewState(previewDefaults);
  try {
    setStoryPreviewActive(true);
    useStore.setState(state, true);
    await expect(sends.send()).rejects.toThrow("Storybook");
    const snapshot = state.snapshots[state.active ?? ""];
    const selection = await rpc.request.setModel({
      ...snapshot.address,
      provider: "openai-codex",
      id: "gpt-6.1-sol",
    });
    expect(selection.model?.provider).toBe("openai-codex");
    await expect(
      rpc.request.setModel({
        ...snapshot.address,
        hostId: "not-the-preview",
        provider: "openai-codex",
        id: "gpt-6.1-sol",
      }),
    ).rejects.toThrow("Storybook");
    expect(useStore.getState().snapshots).toBe(state.snapshots);
    setStoryPreviewActive(false);
    updateAppearance((appearance) => ({
      ...appearance,
      themeColor: "#ff0000",
    }));
    expect(useStore.getState().appearance).toBe(state.appearance);
  } finally {
    setStoryPreviewActive(false);
    useStore.setState(previous, true);
  }
});

test("the screen preview adds layout only, not replacement component styling", () => {
  const path = fileURLToPath(new URL("./preview.css", import.meta.url));
  postcss.parse(readFileSync(path, "utf8")).walkRules((rule) => {
    expect(
      rule.selectors.every((selector) => selector.startsWith(".current-ui-")),
    ).toBe(true);
    rule.walkDecls((declaration) => {
      expect([
        "background",
        "background-color",
        "opacity",
        "border-radius",
      ]).not.toContain(declaration.prop);
    });
  });
});

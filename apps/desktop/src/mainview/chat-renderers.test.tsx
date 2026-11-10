import { afterEach, expect, test } from "bun:test";
import {
  type ChatRenderData,
  type ChatRendererProps,
  defineChatRenderers,
} from "@pig/chat-renderers";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatContent } from "./ChatContent";
import { reloadChatRenderers } from "./chat-renderer-client";
import {
  installChatRenderers,
  rendererSnapshot,
  selectChatRenderer,
} from "./chat-renderer-registry";

afterEach(() => installChatRenderers([]));
const tool: ChatRenderData["tool"] = {
  call: { id: "call-1", name: "lens", arguments: { path: "a.ts" } },
  live: true,
};
const Builtin = ({ data }: ChatRendererProps<"tool">) => (
  <pre>
    {data.call.name}:{data.state?.status ?? "waiting"}
  </pre>
);

test("first matching tool component receives arguments, partial result and state; built-in remains callable", () => {
  installChatRenderers(
    defineChatRenderers([
      { id: "other", kind: "markdown", component: () => <p>wrong kind</p> },
      {
        id: "lens",
        kind: "tool",
        match: (data) => data.call.name === "lens",
        component: function Lens({ data, DefaultRenderer }) {
          const [label] = useState("lens-ui");
          return (
            <section>
              <strong>
                {label}:{String(data.call.arguments.path)}
              </strong>
              <pre>{JSON.stringify(data.state?.result)}</pre>
              <DefaultRenderer />
            </section>
          );
        },
      },
      { id: "later", kind: "tool", component: () => <p>wrong order</p> },
    ]),
  );
  const html = renderToStaticMarkup(
    <ChatContent
      kind="tool"
      data={{
        ...tool,
        state: { status: "running", result: { details: { found: 2 } } },
      }}
      builtin={Builtin}
    />,
  );
  expect(html).toContain("lens-ui:a.ts");
  expect(html).toContain("found");
  expect(html).toContain("lens:running");
  expect(html).not.toContain("wrong");
});
test("unmatched kinds fall back, all render kinds accept a component", () => {
  installChatRenderers([
    {
      id: "lens",
      kind: "tool",
      match: (data: ChatRenderData["tool"]) => data.call.name === "another",
      component: () => null,
    },
  ]);
  expect(
    renderToStaticMarkup(
      <ChatContent kind="tool" data={tool} builtin={Builtin} />,
    ),
  ).toContain("lens:waiting");
  for (const kind of [
    "markdown",
    "image",
    "thinking",
    "tool",
    "custom",
  ] as const) {
    installChatRenderers([{ id: kind, kind, component: () => null }]);
    expect(rendererSnapshot().renderers[0].kind).toBe(kind);
  }
});
test("validation is atomic and a failed predicate does not hide the next match", async () => {
  installChatRenderers([{ id: "good", kind: "tool", component: Builtin }]);
  const before = rendererSnapshot();
  for (const invalid of [
    null,
    [{ id: "bad", kind: "wat", component: Builtin }],
    [{ id: "bad", kind: "tool", component: 1 }],
    [
      { id: "same", kind: "tool", component: Builtin },
      { id: "same", kind: "tool", component: Builtin },
    ],
  ]) {
    expect(() => installChatRenderers(invalid)).toThrow();
    expect(rendererSnapshot()).toBe(before);
  }
  installChatRenderers([
    {
      id: "throws",
      kind: "tool",
      match() {
        throw new Error("bad predicate");
      },
      component: Builtin,
    },
    { id: "next", kind: "tool", component: Builtin },
  ]);
  expect(selectChatRenderer("tool", tool)?.id).toBe("next");
  await Promise.resolve();
  expect(rendererSnapshot().diagnostics.join()).toContain("bad predicate");
});
test("reload keeps last good renderers on compilation, module and validation errors; removing file restores defaults", async () => {
  await reloadChatRenderers(
    async () => ({ file: "file", source: "good" }),
    async () => ({
      default: [{ id: "good", kind: "tool", component: Builtin }],
    }),
  );
  const previous = rendererSnapshot().renderers;
  expect(
    await reloadChatRenderers(async () => ({
      file: "file",
      source: null,
      error: "compile failed",
    })),
  ).toBe(false);
  expect(rendererSnapshot().renderers).toBe(previous);
  expect(
    await reloadChatRenderers(
      async () => ({ file: "file", source: "throws" }),
      async () => {
        throw new Error("module failed");
      },
    ),
  ).toBe(false);
  expect(rendererSnapshot().renderers).toBe(previous);
  expect(
    await reloadChatRenderers(
      async () => ({ file: "file", source: "invalid" }),
      async () => ({ default: {} }),
    ),
  ).toBe(false);
  expect(rendererSnapshot().renderers).toBe(previous);
  expect(
    await reloadChatRenderers(async () => ({ file: "file", source: null })),
  ).toBe(true);
  expect(rendererSnapshot().renderers).toHaveLength(0);
});
test("a late reload cannot override a newer request", async () => {
  let finish!: (value: { file: string; source: string }) => void;
  const older = reloadChatRenderers(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    async () => ({
      default: [{ id: "old", kind: "tool", component: Builtin }],
    }),
  );
  await reloadChatRenderers(
    async () => ({ file: "file", source: "newest" }),
    async () => ({
      default: [{ id: "new", kind: "tool", component: Builtin }],
    }),
  );
  finish({ file: "file", source: "older" });
  expect(await older).toBe(false);
  expect(rendererSnapshot().renderers[0].id).toBe("new");
});

test("reloading an unchanged last-good source clears a previous error", async () => {
  const fetchGood = async () => ({
    file: "file",
    source: "recover-same-source",
  });
  await reloadChatRenderers(fetchGood, async () => ({
    default: [{ id: "recover", kind: "tool", component: Builtin }],
  }));
  await reloadChatRenderers(async () => ({
    file: "file",
    source: null,
    error: "broken edit",
  }));
  expect(rendererSnapshot().error).toContain("broken edit");
  expect(
    await reloadChatRenderers(fetchGood, async () => {
      throw new Error("should use last good module");
    }),
  ).toBe(true);
  expect(rendererSnapshot().error).toBeUndefined();
  expect(rendererSnapshot().renderers[0].id).toBe("recover");
});

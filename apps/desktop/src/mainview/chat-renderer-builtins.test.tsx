import { afterEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ChatRenderer } from "@pig/chat-renderers";
import { renderToStaticMarkup } from "react-dom/server";
import { installChatRenderers } from "./chat-renderer-registry";

if (process.env.PIG_RENDERER_BUILTINS_CHILD !== "1") {
  test("built-in renderer integration in an isolated process", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_RENDERER_BUILTINS_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  });
} else {
  mock.module("./rpc", () => ({
    rpc: { send: {}, request: {} },
    openChatLink: async () => {},
    regenerate: async () => {},
  }));
  const { Markdown, MessageContent, ToolResultContent } = await import(
    "./MessageContent"
  );
  const { ImageGallery } = await import("./ImageGallery");
  const { ToolBlock, ToolGroup, ThinkingBlock } = await import("./ToolBlock");
  const { CustomRecord } = await import("./CustomRecord");
  const { DisclosureScope } = await import("./LazyDetails");
  afterEach(() => installChatRenderers([]));

  test("existing markdown, gallery, shell, thinking and custom records use the shared dispatch", () => {
    installChatRenderers([
      {
        id: "markdown",
        kind: "markdown",
        component: ({ DefaultRenderer }) => (
          <section data-test="markdown">
            <DefaultRenderer />
          </section>
        ),
      },
      {
        id: "image",
        kind: "image",
        component: ({ DefaultRenderer }) => (
          <section data-test="image">
            <DefaultRenderer />
          </section>
        ),
      },
      {
        id: "bash",
        kind: "tool",
        match: (data) => data.call.name === "bash",
        component: ({ data, DefaultRenderer }) => (
          <section data-test="bash">
            <span>{data.call.id}</span>
            <DefaultRenderer />
          </section>
        ),
      },
      {
        id: "thinking",
        kind: "thinking",
        component: ({ DefaultRenderer }) => (
          <section data-test="thinking">
            <DefaultRenderer />
          </section>
        ),
      },
      {
        id: "custom",
        kind: "custom",
        match: (data) => data.customType === "lens",
        component: ({ data, DefaultRenderer }) => (
          <section data-test="custom">
            <span>{data.entryId}</span>
            <DefaultRenderer />
          </section>
        ),
      },
    ] satisfies ChatRenderer[]);
    const markdown = renderToStaticMarkup(
      <Markdown text="# Existing heading" />,
    );
    expect(markdown).toContain('data-test="markdown"');
    expect(markdown).toContain("<h1>Existing heading</h1>");
    const image = renderToStaticMarkup(
      <ImageGallery sources={["data:image/png;base64,YWJj"]} />,
    );
    expect(image).toContain('data-test="image"');
    expect(image).toContain("image-preview");
    const diagram = renderToStaticMarkup(
      <Markdown text="![分岐図](diagram.png)" />,
    );
    expect(diagram).toContain('alt="分岐図"');
    expect(diagram).toMatch(/aria-label="[^"]*分岐図"/);
    const bash = renderToStaticMarkup(
      <ToolBlock
        call={{
          id: "bash-call",
          name: "bash",
          arguments: { command: "echo hello" },
        }}
        state={{
          status: "done",
          result: { content: [{ type: "text", text: "hello" }] },
        }}
        live={false}
      />,
    );
    expect(bash).toContain('data-test="bash"');
    expect(bash).toContain("bash-call");
    expect(bash).toContain("echo hello");
    expect(bash).toContain(
      '</summary><pre class="tool-peek">hello</pre><pre class="tool-term-output"><span>hello</span></pre>',
    );
    expect(bash).not.toContain('<span class="tool-peek">');
    const opened = renderToStaticMarkup(
      <DisclosureScope id="shell" reveal={1}>
        <ToolBlock
          call={{
            id: "shell",
            name: "bash",
            arguments: { command: "echo hello" },
          }}
          state={{
            status: "done",
            result: { content: [{ type: "text", text: "hello" }] },
          }}
          live={false}
        />
      </DisclosureScope>,
    );
    expect(opened).toContain('class="tool-term-output"><span>hello</span>');
    expect(
      renderToStaticMarkup(
        <ThinkingBlock text="Reason" label="Thinking" active={false} />,
      ),
    ).toContain('data-test="thinking"');
    const custom = renderToStaticMarkup(
      <CustomRecord
        record={{
          id: "custom",
          entryId: "saved-entry",
          branchId: "branch",
          parentId: null,
          order: 0,
          kind: "custom-entry",
          customType: "lens",
          data: { items: ["retained"] },
        }}
      />,
    );
    expect(custom).toContain('data-test="custom"');
    expect(custom).toContain("saved-entry");
    expect(custom).toContain("retained");
  });
  test("toolViews card data remains available in the default tool renderer", () => {
    installChatRenderers([
      {
        id: "decorate",
        kind: "tool",
        component: ({ DefaultRenderer }) => (
          <aside>
            <DefaultRenderer />
          </aside>
        ),
      },
    ] satisfies ChatRenderer[]);
    const html = renderToStaticMarkup(
      <ToolBlock
        call={{ id: "t", name: "unknown", arguments: {} }}
        state={{ status: "done" }}
        live={false}
        card={{
          title: "Existing card",
          body: [{ type: "text", text: "Existing content" }],
        }}
      />,
    );
    expect(html).toContain("Existing card");
    expect(html).toContain("Existing content");
  });

  test("Markdown code fences and file writes use syntax tokens without changing inline code", async () => {
    const { highlightCode } = await import("./syntax-highlighting");
    const code = 'const greeting = "hello";';
    await highlightCode(`${code}\n`, "ts");
    await highlightCode(code, "ts");
    const html = renderToStaticMarkup(
      <Markdown text={`Inline \`literal\`\n\n\`\`\`ts\n${code}\n\`\`\``} />,
    );
    expect(html).toContain("<code>literal</code>");
    expect(html).toContain(
      '<pre><code class="language-ts"><span class="syntax-token"',
    );
    const write = renderToStaticMarkup(
      <ToolBlock
        call={{
          id: "write",
          name: "write",
          arguments: { path: "greeting.ts", content: code },
        }}
        state={{ status: "done" }}
        live={false}
      />,
    );
    expect(write).toContain(
      '<pre class="tool-code"><span class="syntax-token"',
    );
    const unknown = renderToStaticMarkup(
      <Markdown text={"```unknown\nliteral\n```"} />,
    );
    expect(unknown).toContain(
      '<code class="language-unknown">literal\n</code>',
    );
  });

  test("Bash ANSI output and EDIT code retain their built-in shell and diff structure", async () => {
    const { highlightCode } = await import("./syntax-highlighting");
    const output = "\u001b[32mPASS\u001b[0m";
    await highlightCode(output, "ansi");
    const shell = renderToStaticMarkup(
      <ToolBlock
        call={{
          id: "ansi",
          name: "bash",
          arguments: { command: "echo result" },
        }}
        state={{
          status: "done",
          result: { content: [{ type: "text", text: output }] },
        }}
        live={false}
      />,
    );
    expect(shell).toContain('<pre class="tool-peek">PASS</pre>');
    expect(shell).toContain(
      '<pre class="tool-term-output"><span><span class="syntax-token"',
    );
    expect(shell).not.toContain("\u001b");
    await highlightCode("const x = 1;", "ts");
    await highlightCode("const x = 2;", "ts");
    const edit = renderToStaticMarkup(
      <ToolBlock
        call={{ id: "edit", name: "edit", arguments: { path: "file.ts" } }}
        state={{
          status: "done",
          result: { details: { diff: "-1 const x = 1;\n+1 const x = 2;" } },
        }}
        live={false}
      />,
    );
    expect(edit).toContain(
      '<pre class="tool-diff"><span class="del">-1 <span class="syntax-token"',
    );
    expect(edit).toContain('<span class="add">+1 <span class="syntax-token"');
  });

  test("large content renders completely with the original Markdown and pre structure", () => {
    const text = "x".repeat(132_000);
    const markdown = renderToStaticMarkup(
      <Markdown text={`# Large\n\n${text}`} />,
    );
    expect(markdown).toBe(`<h1>Large</h1>\n<p>${text}</p>`);
    expect(
      renderToStaticMarkup(<MessageContent content={text} markdown={false} />),
    ).toBe(`<div class="message-content literal"><pre>${text}</pre></div>`);
    expect(renderToStaticMarkup(<ToolResultContent result={text} />)).toBe(
      `<pre>${text}</pre>`,
    );
  });

  test("grouped calls keep direct details children, complete content and search identity", () => {
    const calls = Array.from({ length: 105 }, (_, index) => ({
      type: "toolCall" as const,
      id: `call-${index}`,
      name: "read",
      arguments: { path: `file-${index}` },
    }));
    const html = renderToStaticMarkup(
      <DisclosureScope id="group" reveal={1}>
        <ToolGroup
          calls={calls}
          tools={{}}
          live={false}
          target={{ toolCallId: "call-104", serial: 1 }}
        />
      </DisclosureScope>,
    );
    expect(html).toContain('<div class="tool-group-body"><details ');
    expect(html.match(/data-tool-call-id="call-/g)).toHaveLength(105);
    expect(html).toMatch(
      /<details [^>]*data-tool-call-id="call-104"[^>]*open=""><summary>/,
    );
    expect(html).not.toMatch(
      /<details [^>]*data-tool-call-id="call-0"[^>]*open=/,
    );
    expect(html).not.toContain("text-range");
  });

  test("native details retain saved expansion without adding markup wrappers", () => {
    const html = renderToStaticMarkup(
      <DisclosureScope id="saved" values={{ "/saved/tool:read/body": true }}>
        <ToolBlock
          call={{ id: "read", name: "read", arguments: { path: "file.ts" } }}
          state={{ status: "done" }}
          live={false}
        />
      </DisclosureScope>,
    );
    expect(html).toMatch(
      /^<details [^>]*data-tool-call-id="read"[^>]*open=""><summary>/,
    );
    expect(html).toContain('</summary><div class="tool-body">');
  });
}

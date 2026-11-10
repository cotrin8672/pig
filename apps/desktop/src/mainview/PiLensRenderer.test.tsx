import { afterEach, expect, mock, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ChatRenderData } from "@pig/chat-renderers";
import { renderToStaticMarkup } from "react-dom/server";
import {
  installChatRenderers,
  registerBuiltinChatRenderers,
  selectChatRenderer,
} from "./chat-renderer-registry";

if (process.env.PIG_LENS_RENDERER_TEST_CHILD !== "1") {
  test("pi-lens uses the real built-in components in an isolated process", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_LENS_RENDERER_TEST_CHILD: "1" },
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
  const { piLensRenderer, piLensSummary } = await import("./PiLensRenderer");
  const { ToolBlock, WorkToggle } = await import("./ToolBlock");
  const { Markdown, UserMessage, ToolResultContent } = await import(
    "./MessageContent"
  );
  type ToolData = ChatRenderData["tool"];
  const fixture = (
    name: string,
    args: Record<string, unknown> = {},
    details: unknown = {},
    text = "result",
  ): ToolData => ({
    call: { id: `fixture-${name}`, name, arguments: args },
    state: {
      status: "done",
      result: { content: [{ type: "text", text }], details },
    },
    live: false,
  });
  const render = (data: ToolData) => {
    registerBuiltinChatRenderers([piLensRenderer]);
    return renderToStaticMarkup(<ToolBlock {...data} />);
  };
  afterEach(() => {
    installChatRenderers([]);
    registerBuiltinChatRenderers([]);
  });
  const cases = {
    references: fixture(
      "lsp_navigation",
      {
        operation: "references",
        path: "src/session.ts",
        symbol: "openSession",
      },
      { operation: "references", resultCount: 3, supported: true },
      "src/App.tsx:84:11\nsrc/SessionList.tsx:52:7\nsrc/App.tsx:126:9\nusage tokens=42 elapsed-ms=180 bytes=90 truncated=false",
    ),
    diagnostics: fixture(
      "lens_diagnostics",
      { source: "lsp", paths: ["src/session.ts"] },
      {
        source: "lsp",
        totalDiagnostics: 2,
        totalErrors: 1,
        totalWarnings: 1,
        filesChecked: 1,
      },
      "src/session.ts:42:9: error: session may be undefined\nsrc/session.ts:17:7: warning: unused variable previous",
    ),
    read: fixture(
      "read_symbol",
      { path: "src/session.ts", symbol: "openSession" },
      {
        found: true,
        startLine: 12,
        endLine: 19,
        kind: "function",
        name: "openSession",
      },
      '12  export async function openSession(id: string) {\n13    const saved = await storage.read(id);\n14    if (!saved) {\n15      throw new Error("Session not found");\n16    }\n17    const session = restore(saved);\n18    return session;\n19  }',
    ),
    search: fixture(
      "ast_grep_search",
      { pattern: "console.log($MSG)", lang: "typescript", paths: ["src"] },
      { matchCount: 2, totalMatches: 2 },
      "src/session.ts:28:3\nconsole.log(session.id);\nsrc/storage.ts:41:5\nconsole.log(error);",
    ),
    replace: fixture(
      "ast_grep_replace",
      { pattern: "var $X", rewrite: "let $X", apply: true },
      { matchCount: 2, applied: false },
      "Preview only\n- var sessions = new Map();\n+ let sessions = new Map();",
    ),
    module: fixture(
      "module_report",
      { path: "src/session.ts" },
      { symbols: 3, exports: 1 },
      "function openSession L12-19\nfunction restore L21-38\nclass SessionStore L40-80",
    ),
  };

  test("all pi-lens tool names are exact and other tools or configured cards are not captured", () => {
    for (const name of [
      "read_symbol",
      "read_enclosing",
      "ast_grep_search",
      "ast_grep_replace",
      "ast_grep_outline",
      "lsp_navigation",
      "lens_diagnostics",
      "lens_diagnostic_mark",
      "symbol_search",
      "module_report",
      "project_report",
      "effective_config",
      "pi_lens_activate_tools",
    ]) {
      registerBuiltinChatRenderers([piLensRenderer]);
      expect(selectChatRenderer("tool", fixture(name))?.id).toBe(
        "builtin:pi-lens",
      );
    }
    expect(
      selectChatRenderer("tool", fixture("not_lsp_navigation")),
    ).toBeUndefined();
    expect(
      selectChatRenderer("tool", {
        ...cases.read,
        card: { title: "User card" },
      }),
    ).toBeUndefined();
  });
  test("pi-lens is identified by extension and operation, with code output but no raw Tool details", () => {
    const html = render(cases.references);
    expect(html).toContain('class="tool-row done"');
    expect(html).toContain('class="tool-body"');
    expect(html).toContain("3 results");
    expect(html).toContain("src/App.tsx:84:11");
    expect(html).toContain("usage tokens=42");
    expect(html).toContain("pi-lens · references");
    expect(html).toContain('class="message-content literal"');
    expect(html).not.toContain("Tool details");
    expect(html).not.toContain("supported");
    expect(
      (cases.references.state?.result as { details: { supported: boolean } })
        .details.supported,
    ).toBe(true);
    expect(html).not.toContain("fixture-lsp_navigation");
  });
  test("read ranges and preview/applied state come from actual result metadata", () => {
    expect(render(cases.read)).toContain("L12–19");
    const preview = piLensSummary(cases.replace);
    expect(preview.meta).toContain("preview");
    expect(preview.meta).not.toContain("applied");
    expect(
      piLensSummary(fixture("ast_grep_replace", { apply: true })).meta,
    ).not.toContain("applied");
  });
  test("unconfirmed, malformed and empty diagnostics never invent clean or zero counts", () => {
    const data = fixture(
      "lens_diagnostics",
      {},
      {
        unconfirmed: true,
        timedOut: true,
        totalDiagnostics: "0",
        totalWarnings: null,
      },
    );
    expect(piLensSummary(data).meta).toBe("unconfirmed");
    expect(render(data)).toContain("unconfirmed");
    expect(piLensSummary(fixture("lens_diagnostics", {}, null)).meta).toBe("");
    expect(
      piLensSummary(
        fixture(
          "module_report",
          { paths: [null, "src", 4] },
          { symbols: -1, exports: Infinity },
        ),
      ).target,
    ).toBe("src");
  });
  test("native running, failure and interruption states are retained", () => {
    expect(
      render({
        ...cases.read,
        state: { status: "running", result: cases.read.state?.result },
        live: true,
      }),
    ).toContain('class="tool-row running"');
    expect(
      render({
        ...cases.read,
        state: { status: "error", result: cases.read.state?.result },
      }),
    ).toContain('class="tool-row error"');
    expect(render({ ...cases.read, state: undefined, live: false })).toContain(
      'class="tool-row error"',
    );
    expect(
      render(fixture("read_symbol", {}, { found: false }, "Symbol not found")),
    ).toContain("not found");
  });
  test("user React definitions override the built-in pi-lens renderer", () => {
    registerBuiltinChatRenderers([piLensRenderer]);
    installChatRenderers([
      {
        id: "user-lens",
        kind: "tool",
        match: () => true,
        component: () => <span>User override</span>,
      },
    ]);
    expect(renderToStaticMarkup(<ToolBlock {...cases.read} />)).toBe(
      "<span>User override</span>",
    );
  });

  test("generic tools never expose raw Tool details or details-only payloads", () => {
    const result = Object.freeze({
      content: [{ type: "text", text: "Visible result" }],
      isError: true,
      details: Object.freeze({ internalOnlyMarker: "hidden metadata" }),
    });
    const before = JSON.stringify(result);
    const html = renderToStaticMarkup(<ToolResultContent result={result} />);
    expect(html).toContain("Visible result");
    expect(html).toContain("Tool failed");
    expect(html).not.toContain("internalOnlyMarker");
    expect(html).not.toContain("Tool details");
    expect(html).not.toContain("<details");
    expect(
      renderToStaticMarkup(
        <ToolResultContent result={{ details: result.details }} />,
      ),
    ).toBe("");
    const generic = render(
      fixture(
        "unrecognized_extension_tool",
        {},
        result.details,
        "Visible generic output",
      ),
    );
    expect(generic).toContain("Visible generic output");
    expect(generic).not.toContain("internalOnlyMarker");
    expect(JSON.stringify(result)).toBe(before);
  });

  test("every supported tool identifies pi-lens and LSP operation is not repeated in the target", () => {
    for (const name of [
      "read_symbol",
      "read_enclosing",
      "ast_grep_search",
      "ast_grep_replace",
      "ast_grep_outline",
      "lens_diagnostics",
      "lens_diagnostic_mark",
      "symbol_search",
      "module_report",
      "project_report",
      "effective_config",
      "pi_lens_activate_tools",
    ]) {
      expect(render(fixture(name))).toContain(`pi-lens · ${name}`);
    }
    expect(piLensSummary(cases.references)).toMatchObject({
      operation: "references",
      target: "src/session.ts · openSession",
    });
    expect(
      piLensSummary(fixture("lsp_navigation", { operation: "hover" }))
        .operation,
    ).toBe("hover");
  });

  if (process.env.PI_LENS_PREVIEW_OUTPUT && process.env.PI_LENS_PREVIEW_CSS) {
    const { useStore } = await import("./store");
    const initialState = useStore.getInitialState();
    Object.assign(initialState, {
      settings: { ...initialState.settings, language: "ja" },
    });
    registerBuiltinChatRenderers([piLensRenderer]);
    const baselineRead = fixture(
      "read",
      { path: "src/session.ts", offset: 1, limit: 80 },
      {},
      "export async function openSession(id: string) { /* ... */ }",
    );
    const baselineBash = fixture(
      "bash",
      { command: "pnpm typecheck" },
      {},
      "> tsc --noEmit",
    );
    const fragments: Record<string, string> = {};
    for (const [key, data] of Object.entries(cases)) {
      for (const status of [
        "done",
        "running",
        "error",
        "unconfirmed",
      ] as const) {
        const lens = {
          ...data,
          state: {
            status:
              status === "running"
                ? ("running" as const)
                : status === "error"
                  ? ("error" as const)
                  : ("done" as const),
            result:
              status === "unconfirmed"
                ? {
                    content: [
                      {
                        type: "text",
                        text: "Result incomplete: language server did not confirm all files",
                      },
                    ],
                    details: { unconfirmed: true },
                  }
                : status === "error"
                  ? {
                      content: [{ type: "text", text: "Request timed out" }],
                      isError: true,
                    }
                  : data.state?.result,
          },
          live: status === "running",
        };
        fragments[`${key}:${status}`] = renderToStaticMarkup(
          <>
            <UserMessage
              message={{
                role: "user",
                content: "openSession の参照先と実装を確認して",
                timestamp: 0,
              }}
              sessionId="preview"
              disabled={true}
            />
            <WorkToggle open={true} tools={4} onToggle={() => {}} />
            <div data-preview-work>
              <ToolBlock {...baselineRead} />
              <div data-preview-lens>
                <ToolBlock {...lens} />
              </div>
              <ToolBlock {...cases.read} />
              <ToolBlock {...baselineBash} />
            </div>
            <div className="prose">
              <Markdown text="openSession の参照先と実装を確認しました。**表示データはサンプル**です。" />
            </div>
          </>,
        );
      }
    }
    const css = await readFile(process.env.PI_LENS_PREVIEW_CSS, "utf8");
    const templates = Object.entries(fragments)
      .map(([key, html]) => `<template id="case-${key}">${html}</template>`)
      .join("\n");
    const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>既存 React コンポーネントの pi-lens 表示</title><style>${css}</style></head><body><div id="root"><div class="app-shell"><main style="flex:1;overflow:auto;padding:24px"><div class="transcript"><p class="muted">実際の ToolBlock・ToolRow・ToolResultContent・Markdown を使用しています。新しいカード用 CSS はありません。</p><label>ツール <select id="preview-tool"><option value="references">LSP references</option><option value="diagnostics">Diagnostics</option><option value="read">Read symbol</option><option value="search">AST Search</option><option value="replace">AST Replace</option><option value="module">Module report</option></select></label> <label>状態 <select id="preview-state"><option value="done">完了</option><option value="running">実行中</option><option value="error">失敗</option><option value="unconfirmed">未確認</option></select></label><div id="preview-result" style="margin-top:24px">${fragments["references:done"]}</div></div></main></div></div>${templates}<script>const tool=document.getElementById('preview-tool'),state=document.getElementById('preview-state'),result=document.getElementById('preview-result');function wire(){const lens=result.querySelector('[data-preview-lens] details');if(lens)lens.open=true;const toggle=result.querySelector('.work-toggle'),work=result.querySelector('[data-preview-work]');toggle.addEventListener('click',()=>{work.hidden=!work.hidden;toggle.setAttribute('aria-expanded',String(!work.hidden))})}function change(){result.replaceChildren(document.getElementById('case-'+tool.value+':'+state.value).content.cloneNode(true));wire()}tool.addEventListener('change',change);state.addEventListener('change',change);wire();</script></body></html>`;
    await writeFile(process.env.PI_LENS_PREVIEW_OUTPUT, html);
  }
}

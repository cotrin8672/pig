import type { ToolFixture } from "./kit";

/*
 * Fixtures for pi-codex-search 0.x (codex_search) and @howaboua/pi-codex-imagegen
 * (imagegen). Text and details follow formatToolText / formatImagegenOutput.
 */

const answers = [
  {
    query: "Bun 1.3 release notes Windows",
    text: "Bun 1.3 adds a native Windows installer and fixes path handling in `bun build --compile`. The release also ships a faster `bun install` on NTFS by batching file copies, and `Bun.spawn` now supports `windowsHide`.",
    citations: [
      {
        title: "Bun v1.3 | Bun Blog",
        url: "https://bun.sh/blog/bun-v1.3",
        startIndex: 0,
        endIndex: 90,
      },
      {
        title: "Release Bun v1.3.0 · oven-sh/bun",
        url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.0",
        startIndex: 91,
        endIndex: 170,
      },
      {
        title: "Bun.spawn – API reference",
        url: "https://bun.sh/docs/api/spawn",
        startIndex: 171,
        endIndex: 214,
      },
    ],
  },
  {
    query: "Electrobun WebView2 transparency",
    text: "Electrobun's Windows renderer uses WebView2. Transparent windows require `DefaultBackgroundColor` set to transparent before the first navigation; acrylic is applied by the host window, not WebView2.",
    citations: [
      {
        title: "Electrobun docs – BrowserWindow",
        url: "https://electrobun.dev/docs/apis/browser-window",
        startIndex: 0,
        endIndex: 44,
      },
      {
        title: "ICoreWebView2Controller2.DefaultBackgroundColor",
        url: "https://learn.microsoft.com/microsoft-edge/webview2/reference/win32/icorewebview2controller2",
        startIndex: 45,
        endIndex: 160,
      },
    ],
  },
];

/** Real citations end on sentence boundaries; place each fixture span on one. */
for (const answer of answers) {
  const ends = [...answer.text.matchAll(/[.;](?=\s|$)/g)].map(
    (found) => (found.index ?? 0) + 1,
  );
  answer.citations.forEach((citation, index) => {
    citation.endIndex = ends[Math.min(index, ends.length - 1)];
  });
}

export const codexSearch: ToolFixture = {
  tool: {
    call: {
      id: "codex_search",
      name: "codex_search",
      arguments: {
        queries: answers.map((answer) => answer.query),
        freshness: "live",
        search_context_size: "medium",
      },
    },
    live: false,
    state: {
      status: "done",
      result: {
        content: [
          {
            type: "text",
            text: answers
              .map(
                (answer) =>
                  `## Query: ${answer.query}\n\n${answer.text}\n\nSources:\n${answer.citations
                    .map((c, i) => `${i + 1}. ${c.title}: ${c.url}`)
                    .join("\n")}`,
              )
              .join("\n\n"),
          },
        ],
        details: {
          model: "gpt-5.4-mini",
          api: "responses",
          freshness: "live",
          searchContextSize: "medium",
          queryCount: 2,
          queries: answers.map((answer) => answer.query),
          failedQueryCount: 0,
          successes: answers.map((answer) => ({
            ...answer,
            searchCalls: [{ status: "completed", query: answer.query }],
          })),
          failures: [],
          elapsedMs: 6420,
        },
      },
    },
  },
  error:
    "Web search failed (auth): ChatGPT Codex login expired. Run /login openai-codex.",
};

/** A small generated artwork, so the preview needs no network or local file. */
const art = btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512" viewBox="0 0 768 512">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a5e"/><stop offset=".55" stop-color="#e27d60"/><stop offset="1" stop-color="#f6c28b"/></linearGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3f7a"/><stop offset="1" stop-color="#0f1a3a"/></linearGradient></defs>
<rect width="768" height="512" fill="url(#s)"/><circle cx="520" cy="300" r="70" fill="#ffe2b0"/>
<path d="M0 330 L120 250 L230 320 L360 210 L480 310 L600 240 L768 330 V512 H0Z" fill="#2b2f55"/>
<rect y="360" width="768" height="152" fill="url(#w)"/>
<path d="M300 420 h120 l-20 22 h-90z" fill="#0b0f22"/><path d="M355 420 v-70 l40 62z" fill="#f3e9dc"/>
</svg>`,
);

export const imagegen: ToolFixture = {
  tool: {
    call: {
      id: "imagegen",
      name: "imagegen",
      arguments: {
        prompt:
          "Calm sunset over a mountain lake with a small sailboat, flat illustration, 3:2 landscape, high quality",
        transparent_background: false,
      },
    },
    live: false,
    state: {
      status: "done",
      result: {
        content: [
          {
            type: "text",
            text: "Generated image: .pi/openai-codex-images/ig_e0a26b586a0e.png\nLatest: .pi/openai-codex-images/latest.png",
          },
          { type: "image", data: art, mimeType: "image/svg+xml" },
        ],
        details: {
          path: ".pi/openai-codex-images/ig_e0a26b586a0e.png",
          latest_path: ".pi/openai-codex-images/latest.png",
          images: [
            {
              path: ".pi/openai-codex-images/ig_e0a26b586a0e.png",
              mime_type: "image/png",
            },
          ],
          background: "opaque",
          quality: "high",
          size: "1536x1024",
          output_format: "png",
          imagegen_request_id: "ig_e0a26b586a0e",
        },
      },
    },
  },
  error:
    "imagegen requires an image-capable OpenAI Codex-compatible Responses provider",
};

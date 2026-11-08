import { expect, test } from "bun:test";
import { type Credential, createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { CODEX_IMAGE_API, codexImages, withCodexImages } from "./codex-images";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
).toString("base64");
function setup() {
  let credential: Credential | undefined = {
    type: "oauth",
    access: "fake-access",
    refresh: "fake-refresh",
    expires: Date.now() + 3600000,
    accountId: "fake-account",
  };
  const runtime = createModels({
    credentials: {
      async delete() {
        credential = undefined;
      },
      async read() {
        return credential;
      },
      async list() {
        return credential
          ? [{ providerId: "openai-codex", type: credential.type }]
          : [];
      },
      async modify(_id, fn) {
        const next = await fn(credential);
        if (next !== undefined) credential = next ?? undefined;
        return credential;
      },
    },
  });
  runtime.setProvider(withCodexImages(openaiCodexProvider()));
  const model = runtime.getModelOfType(
    "image",
    "openai-codex",
    "gpt-image-2.5",
  );
  if (!model) throw new Error("Missing image model");
  return { runtime, model };
}

test("Codex images dispatch through runtime OAuth with JSON generation and edit requests", async () => {
  const { runtime, model } = setup();
  let calls = 0;
  const mockedFetch: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(input)).toBe(
        `https://chatgpt.com/backend-api/codex/images/${calls === 1 ? "generations" : "edits"}`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer fake-access");
      expect(headers.get("chatgpt-account-id")).toBe("fake-account");
      expect(headers.get("originator")).toBe("pig");
      expect(headers.get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: model.id,
        prompt: "draw\na cat",
        size: "auto",
        ...(calls === 2
          ? { images: [{ image_url: `data:image/png;base64,${png}` }] }
          : {}),
      });
      return Response.json({
        data: [{ b64_json: png, revised_prompt: "a small cat" }],
        usage: { input_tokens: 5, output_tokens: 6 },
      });
    },
    { preconnect: fetch.preconnect },
  );
  for (const edit of [false, true]) {
    const result = await runtime.generateImages(
      model,
      {
        input: [
          { type: "text", text: "draw" },
          { type: "text", text: "a cat" },
          ...(edit
            ? [{ type: "image" as const, data: png, mimeType: "image/png" }]
            : []),
        ],
      },
      { fetch: mockedFetch },
    );
    expect(result.stopReason).toBe("stop");
    expect(result.api).toBe(CODEX_IMAGE_API);
    expect(result.output).toEqual([
      { type: "text", text: "a small cat" },
      { type: "image", data: png, mimeType: "image/png" },
    ]);
    expect(result.usage?.totalTokens).toBe(11);
  }
  expect(calls).toBe(2);
});

test("Codex image HTTP, malformed content, network and cancellation errors surface safely", async () => {
  const { runtime, model } = setup();
  for (const [response, error] of [
    [new Response("secret", { status: 401 }), "IMAGE_AUTH_FAILED"],
    [new Response("secret", { status: 429 }), "IMAGE_HTTP_429"],
    [new Response("not JSON"), "IMAGE_INVALID_RESPONSE"],
    [Response.json({ data: [] }), "IMAGE_INVALID_RESPONSE"],
    [Response.json({ data: [{ b64_json: "bad!" }] }), "IMAGE_INVALID_RESPONSE"],
    [Response.json({ data: [{ b64_json: "YWJj" }] }), "IMAGE_INVALID_CONTENT"],
  ] as const) {
    const result = await runtime.generateImages(
      model,
      { input: [] },
      {
        fetch: Object.assign(async () => response, {
          preconnect: fetch.preconnect,
        }),
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(error);
  }
  const failed = await runtime.generateImages(
    model,
    { input: [] },
    {
      fetch: Object.assign(
        async () => {
          throw new Error("secret");
        },
        { preconnect: fetch.preconnect },
      ),
    },
  );
  expect(failed.errorMessage).toBe("IMAGE_REQUEST_FAILED");
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await codexImages.generateImages(
        model,
        { input: [] },
        { signal: controller.signal },
      )
    ).stopReason,
  ).toBe("aborted");
});

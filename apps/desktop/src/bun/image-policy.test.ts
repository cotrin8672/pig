import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  defineTool,
  type GenerationHooks,
  type HookApi,
  type ToolExecutionApi,
  type ToolHooks,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import {
  createReadTool,
  DEFAULT_IMAGE_LIMITS,
} from "@earendil-works/pi-durable/tools";
import {
  blockedImageNote,
  createNativeImagePolicy,
  decodeImageNote,
  preparePromptImages,
  sanitizePolicyValue,
  sanitizeToolResult,
} from "./image-policy";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
function bmp() {
  const bytes = Buffer.alloc(58);
  bytes.write("BM");
  bytes.writeUInt32LE(58, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(1, 18);
  bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(4, 34);
  return {
    type: "image" as const,
    mimeType: "image/bmp",
    data: bytes.toString("base64"),
  };
}

test("actual native Photon normalizes BMP for idle AND queued admission and native read", async () => {
  const processor = await createNodePhotonImages({ worker: false });
  const image = bmp();
  for (const queued of [false, true]) {
    const result = await preparePromptImages(
      [image],
      { queued, blockImages: false },
      { maxWidth: 1, maxHeight: 1 },
      processor,
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(result.images[0]?.data).not.toBe(image.data);
  }
  expect(
    (
      await preparePromptImages(
        [{ ...image, data: "broken" }],
        { blockImages: false },
        undefined,
        processor,
      )
    ).hints,
  ).toEqual([decodeImageNote]);
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const cwd = await mkdtemp(join(process.env.PI_SCRATCH_DIR, "native-image-"));
  directories.push(cwd);
  await writeFile(join(cwd, "image.bmp"), Buffer.from(image.data, "base64"));
  const api = {
    env: new NodeExecutionEnv({ cwd }),
    agent: async () => ({}),
    models: { getModel: () => undefined },
  } as unknown as ToolExecutionApi;
  const result = await createReadTool({ images: processor }).execute(
    { path: "image.bmp" },
    api,
    ctx,
  );
  expect(result.structuredOutput).toMatchObject({
    type: "image",
    mimeType: "image/png",
  });
});

test("disabled input and read processor stop BEFORE base64/Photon decode", async () => {
  let decodes = 0;
  const policy = createNativeImagePolicy({
    blockImages: () => true,
    processor: {
      prepare: async () => {
        decodes++;
        throw new Error("must not decode");
      },
    },
  });
  const image = {
    type: "image",
    mimeType: "image/bmp",
    get data(): string {
      throw new Error("base64 must not be accessed");
    },
  } as ImageContent;
  expect(await preparePromptImages([image], { blockImages: true })).toEqual({
    images: [],
    hints: [blockedImageNote],
  });
  expect(await policy.prepareInput([image])).toEqual([
    { type: "text", text: blockedImageNote },
  ]);
  expect(
    await policy.images.prepare(
      new Uint8Array([1]),
      "image/bmp",
      DEFAULT_IMAGE_LIMITS,
    ),
  ).toBeUndefined();
  expect(decodes).toBe(0);
});

test("mandatory wraps scrub details BEFORE progress commit and scrub output/structured/control BEFORE return", async () => {
  const policy = createNativeImagePolicy({ blockImages: () => true });
  const image = bmp();
  const persisted: unknown[] = [];
  const tool = defineTool({
    name: "third-party",
    description: "fixture",
    parameters: {},
    async execute(_args, api, context) {
      await api.details(
        { progress: image, encoded: JSON.stringify({ nested: image }) },
        context,
      );
      return {
        output: [image],
        details: { nested: image },
        structuredOutput: { nested: image },
        control: { handoff: JSON.stringify({ nested: image }) },
      };
    },
  });
  const api = {
    details: async (value: unknown) => {
      persisted.push(structuredClone(value));
    },
  } as unknown as ToolExecutionApi;
  const result = await policy.wrap(tool).execute({}, api, ctx);
  const json = JSON.stringify({
    persisted,
    result,
    dto: policy.project({ custom: image }),
  });
  expect(json).not.toContain(image.data);
  expect(json).not.toContain('"type":"image"');
  expect(json).toContain("Image removed");
  const read = sanitizeToolResult(
    { output: [image], structuredOutput: image },
    "read",
    true,
  );
  expect(read.structuredOutput).toBe(blockedImageNote);
  expect(read.output).toEqual([{ type: "text", text: blockedImageNote }]);
  expect(policy.extension([tool]).wraps).toHaveLength(1);
});

test("native afterTool fallback and beforeRequest scrub images without inventing afterResponse replacement", async () => {
  const image = bmp(),
    policy = createNativeImagePolicy({ blockImages: () => true });
  const extension = policy.extension([]);
  const toolHooks = extension.hooks?.[0]?.handlers as Partial<ToolHooks>;
  const generationHooks = extension.hooks?.[1]
    ?.handlers as Partial<GenerationHooks>;
  const api = {} as HookApi;
  const result = await toolHooks.afterTool?.(
    { type: "toolCall", id: "read", name: "read", arguments: {} },
    { output: [image], structuredOutput: image },
    api,
    ctx,
  );
  expect(result?.structuredOutput).toBe(blockedImageNote);
  const request = await generationHooks.beforeRequest?.(
    { messages: [{ role: "user", content: [image], timestamp: 1 }] },
    api,
    ctx,
  );
  expect(JSON.stringify(request)).not.toContain(image.data);
  expect(generationHooks.afterResponse).toBeUndefined();
});

test("sanitization is bounded valid JSON for cycles/non-JSON/details/control and does not execute getters", () => {
  let getters = 0;
  const value: Record<string, unknown> = {
    number: NaN,
    bigint: 1n,
    giant: "x".repeat(2 * 1024 * 1024),
    uri: "data:image/png;base64,secret",
  };
  value.self = value;
  Object.defineProperty(value, "getter", {
    enumerable: true,
    get() {
      getters++;
      return bmp();
    },
  });
  const json = JSON.stringify(sanitizePolicyValue(value, true));
  expect(() => JSON.parse(json)).not.toThrow();
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(1024 * 1024);
  expect(json).not.toContain("secret");
  expect(getters).toBe(0);
});

test("enabled native read preserves repeated image references and model-sized base64 on both result channels", () => {
  const image = {
    type: "image" as const,
    mimeType: "image/png",
    data: "a".repeat(2 * 1024 * 1024),
  };
  const result = sanitizeToolResult(
    { output: [image], structuredOutput: image },
    "read",
    false,
  );
  expect(result.structuredOutput).toEqual(image);
  expect(result.output).toEqual([image]);
});

test("request and DTO scrubs retain large valid message envelopes instead of emitting bare truncation strings", async () => {
  const policy = createNativeImagePolicy({ blockImages: () => true });
  const image = bmp();
  const text = "text".repeat(150);
  const messages = Array.from({ length: 3000 }, (_, timestamp) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text }, image],
    timestamp,
  }));
  const hooks = policy.extension([]).hooks?.[1]
    ?.handlers as Partial<GenerationHooks>;
  const request = await hooks.beforeRequest?.({ messages }, {} as HookApi, ctx);
  expect(request?.messages).toHaveLength(3000);
  expect(request?.messages.at(-1)).toMatchObject({
    role: "user",
    timestamp: 2999,
  });
  const dto = policy.project({ messages });
  expect(dto.messages.at(-1)?.content[0]).toEqual({ type: "text", text });
  expect(JSON.stringify(dto)).not.toContain(image.data);
  expect(sanitizePolicyValue('  { "text": "unchanged" }', true)).toBe(
    '  { "text": "unchanged" }',
  );
  expect(() =>
    sanitizePolicyValue("x".repeat(30), true, { maxBytes: 20, strict: true }),
  ).toThrow("JSON limit exceeded");
});

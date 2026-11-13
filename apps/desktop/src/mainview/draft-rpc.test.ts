import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { DraftState } from "../shared/runtime-contract";

if (process.env.PIG_DRAFT_RPC_CHILD !== "1") {
  test("compact draft recovery with the real RPC handlers in isolation", async () => {
    const child = Bun.spawn(
      [process.execPath, "test", fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, PIG_DRAFT_RPC_CHILD: "1" },
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
  let receive!: (event: ExtensionUIEvent) => void;
  const reads: ReturnType<typeof Promise.withResolvers<DraftState>>[] = [];
  mock.module("electrobun/view", () => ({
    Electroview: class {
      constructor(readonly options: unknown) {}
      static defineRPC(config: {
        handlers: { messages: { extensionUIEvent: typeof receive } };
      }) {
        receive = config.handlers.messages.extensionUIEvent;
        return {
          send: {},
          request: {
            getSessionDraft: () => {
              const read = Promise.withResolvers<DraftState>();
              reads.push(read);
              return read.promise;
            },
          },
        };
      }
    },
  }));
  await import("./rpc");
  const { drafts } = await import("./draft-store");
  const { receiveRuntime } = await import("./runtime-events");
  const image = {
    id: "shared",
    image: { type: "image" as const, mimeType: "image/png", data: "fixture" },
  };
  test("missing references request only one draft and late closed-owner replies cannot restore images", async () => {
    const address = { hostId: "draft-rpc", sessionId: "compact", epoch: 1 };
    const compact = (revision: number): ExtensionUIEvent => ({
      type: "draft",
      address,
      draft: { revision, text: String(revision), pastes: [], images: [] },
      imageRefs: { revision: revision - 1, ids: [image.id] },
    });
    receive(compact(2));
    receive(compact(3));
    await Bun.sleep(0);
    expect(reads).toHaveLength(1);
    reads[0].resolve({
      revision: 3,
      text: "latest",
      pastes: [],
      images: [image],
    });
    await Bun.sleep(0);
    expect(drafts.read(address).content.images).toEqual([image]);
    receive(compact(4));
    expect(drafts.read(address).revision).toBe(4);
    expect(reads).toHaveLength(1);
    receive({
      ...compact(6),
      imageRefs: { revision: 5, ids: [image.id] },
    } as ExtensionUIEvent);
    await Bun.sleep(0);
    expect(reads).toHaveLength(2);
    receiveRuntime({ type: "closed", address, reason: "close" });
    reads[1].resolve({ revision: 6, text: "late", pastes: [], images: [] });
    await Bun.sleep(0);
    expect(drafts.read(address).retired).toBe(true);
    expect(drafts.read(address).content.images).toEqual([image]);
  });
}

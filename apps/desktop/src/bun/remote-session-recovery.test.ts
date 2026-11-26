import { expect, test } from "bun:test";
import { remoteChat } from "./remote-chat";

test("read rotates a suspended view without redirecting old sends or receipt lookups", async () => {
  const a = { hostId: "host", sessionId: "chat", epoch: 1 };
  let epoch = 1;
  const info = { id: "chat", cwd: "root", title: "fixture", modified: 0 };
  const snapshot = () => ({
    address: { ...a, epoch },
    info,
    transcript: { records: [], running: false },
  });
  const receipts: number[] = [];
  const host = {
    listSessions: async () => [info],
    openSession: async () => snapshot(),
    sessionAddress: () => ({ ...a, epoch }),
    isSuspended: () => epoch === 2,
    wakeSession: async () => {
      epoch = 3;
      return snapshot();
    },
    readSessionSnapshot: async () => snapshot(),
    broker: { pending: () => [] },
    prompt: async (addr: typeof a) => {
      if (addr.epoch !== epoch) throw Error("stale");
      return { disposition: "started" };
    },
    getPromptReceipt: (addr: typeof a) => {
      receipts.push(addr.epoch);
      return { state: "unknown" };
    },
  };
  const run = remoteChat(
    host as unknown as Parameters<typeof remoteChat>[0],
    () => ["root"],
  );
  const call = (q: unknown) => run("peer", q, () => {});
  const { chats } = (await call({ op: "list" })) as {
    chats: { chat: string }[];
  };
  const { view } = (await call({ op: "open", chat: chats[0].chat })) as {
    view: string;
  };
  epoch = 2;
  const resumed = (await call({ op: "read", view })) as { view: string };
  expect(resumed.view).toBeString();
  expect(resumed.view).not.toBe(view);
  const send = { op: "send", view, id: "one", text: "hello" };
  await expect(call(send)).rejects.toThrow("stale");
  await call({ op: "receipt", view, id: "one" });
  expect(receipts).toEqual([1]);
  expect(await call({ ...send, view: resumed.view })).toEqual({
    disposition: "started",
  });
});

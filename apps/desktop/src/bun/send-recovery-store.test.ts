import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { DraftStore } from "../mainview/draft-store";
import { SendController } from "../mainview/send-controller";
import type {
  DraftContent,
  DraftOwner,
  PromptParams,
} from "../shared/runtime-contract";
import { ComposerBridge } from "./composer-bridge";
import { SendReceipts } from "./sdk-send-receipts";
import { SendRecoveryStore } from "./send-recovery-store";

const address = { hostId: "original", sessionId: "sdk-session", epoch: 1 };
const content = (text = "draft"): DraftContent => ({
  text,
  pastes: [],
  images: [],
});
async function fixture(
  run: (f: {
    file: string;
    owner: DraftOwner;
    store: SendRecoveryStore;
    bridge: ComposerBridge;
    ledger: SendReceipts;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "piris-recovery-"));
  const file = join(directory, "recovery.sqlite");
  const owner: DraftOwner = {
    cwd: directory,
    sessionFile: join(directory, "session.jsonl"),
    branchId: "leaf",
  };
  const store = new SendRecoveryStore(file);
  const bridge = new ComposerBridge(
    () => {},
    (a, draft, previous, keepImages) =>
      store.draft(a, draft, owner, previous, keepImages),
  );
  const ledger = new SendReceipts(address.hostId, store);
  try {
    await run({ file, owner, store, bridge, ledger });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("acceptance and draft consumption survive a lost clear/renderer; completed payloads are absent", async () => {
  await fixture(async ({ owner, store, bridge, ledger }) => {
    const original = {
      ...content("[paste #1 4 chars]"),
      pastes: [{ id: "p", marker: "[paste #1 4 chars]", text: "sent" }],
      images: [
        {
          id: "i",
          image: {
            type: "image" as const,
            data: "YWJj",
            mimeType: "image/png",
          },
        },
      ],
    };
    const draft = bridge.sync({
      ...address,
      expectedRevision: 0,
      content: original,
    }).draft;
    const params: PromptParams = {
      ...address,
      requestId: "accepted",
      draftRevision: draft.revision,
      text: "sent",
      images: original.images.map((i) => i.image),
    };
    ledger.register(params, { owner, content: original });
    let invocations = 0;
    const session: Pick<AgentSession, "prompt"> = {
      prompt: async (_text, options) => {
        invocations++;
        options?.preflightResult?.("started");
        throw new Error("model failed after acceptance");
      },
    };
    const errors: unknown[] = [];
    await ledger.send(
      params,
      session,
      async () => params,
      (error) => errors.push(error),
      (intent) =>
        bridge.consume(address, draft.revision, (consumed) =>
          store.intent(intent, consumed ? { ...consumed, owner } : undefined),
        ),
    );
    await ledger.settled();
    const saved = store.snapshot([owner], "new-host");
    expect(saved.intents[0].receipt.state).toBe("accepted");
    expect(saved.intents[0].content).toBeUndefined();
    expect(saved.drafts[0].draft.text).toBe("");
    expect(saved.drafts[0].draft.images).toHaveLength(0);
    const renderer = new DraftStore();
    renderer.receive(address, saved.drafts[0].draft);
    const sends = new SendController(
      renderer,
      {
        syncDraft: async () => {
          throw new Error("read-only recovery");
        },
        prompt: async () => {
          throw new Error("must not resend");
        },
        getPromptReceipt: async (key) => ledger.lookup(key),
      },
      () => {},
    );
    sends.restore(saved.intents);
    await sends.lookup(address);
    expect(renderer.read(address).content.text).toBe("");
    expect(sends.read(address)?.key.requestId).toBe("accepted");
    expect({ invocations, errors: errors.length }).toEqual({
      invocations: 1,
      errors: 1,
    });
  });
});

test("two database connections preserve other owners and reject stale ACKs, deleted sessions and discarded drafts", async () => {
  await fixture(async ({ file, owner, store }) => {
    const second = new SendRecoveryStore(file);
    try {
      const other = { ...address, sessionId: "other" };
      store.draft(address, { ...content("one"), revision: 1 }, owner);
      second.draft(other, { ...content("two"), revision: 1 }, owner);
      expect(
        store
          .snapshot([owner], "new")
          .drafts.map((d) => d.draft.text)
          .sort(),
      ).toEqual(["one", "two"]);
      expect(store.snapshot([], "new").drafts).toHaveLength(0);
      second.draft(address, { ...content("newer"), revision: 2 }, owner);
      expect(() =>
        store.draft(address, { ...content("stale"), revision: 1 }, owner),
      ).toThrow("Stale");
      expect(() =>
        store.discard(address, join(owner.cwd, "wrong-project")),
      ).toThrow("owner mismatch");
      store.discard(address, owner.cwd);
      expect(() =>
        second.draft(
          address,
          { ...content("resurrected"), revision: 3 },
          owner,
        ),
      ).toThrow("discarded");
      second.deleteSession(other.sessionId, owner.cwd);
      expect(() =>
        store.draft(other, { ...content("deleted"), revision: 2 }, owner),
      ).toThrow("deleted");
      expect(store.snapshot([owner], "new").drafts).toHaveLength(0);
    } finally {
      second.close();
    }
  });
});

test("prepared and dispatched intents remain unknown across restart and never run SDK during recovery", async () => {
  await fixture(async ({ file, owner, store, ledger }) => {
    const prepared: PromptParams = {
      ...address,
      requestId: "prepared",
      draftRevision: 1,
      text: "prepared",
    };
    ledger.register(prepared, { owner, content: content(prepared.text) });
    const dispatched = { ...prepared, requestId: "dispatched" };
    ledger.register(dispatched, { owner, content: content(dispatched.text) });
    const pending = Promise.withResolvers<void>();
    void ledger
      .send(
        dispatched,
        { prompt: async () => pending.promise },
        async () => ({ text: "prepared" }),
        () => {},
      )
      .catch(() => {});
    await Bun.sleep(0);
    const second = new SendRecoveryStore(file);
    try {
      const restarted = new SendReceipts("new-host", second);
      const restored = second.snapshot([owner], "new-host");
      expect(restored.intents.map((i) => i.receipt.state)).toEqual([
        "unknown",
        "unknown",
      ]);
      expect(restarted.lookup(prepared).state).toBe("unknown");
      let invocations = 0;
      await expect(
        restarted.send(
          prepared,
          {
            prompt: async () => {
              invocations++;
            },
          },
          async () => ({ text: prepared.text }),
          () => {},
        ),
      ).rejects.toThrow("STALE_SESSION_ADDRESS");
      expect(invocations).toBe(0);
    } finally {
      second.close();
      ledger.cancel(address);
      pending.resolve();
      await ledger.settled();
    }
    expect(store.snapshot([owner], "new-host").intents).not.toHaveLength(0);
  });
});

test("disk write failure after SDK acceptance preserves acceptance in memory and leaves durable uncertainty", async () => {
  await fixture(async ({ owner, store, bridge, ledger }) => {
    const draft = bridge.sync({
      ...address,
      expectedRevision: 0,
      content: content(),
    }).draft;
    const params = {
      ...address,
      requestId: "disk-full",
      draftRevision: draft.revision,
      text: "draft",
    };
    ledger.register(params, { owner, content: content() });
    const errors: unknown[] = [];
    await ledger.send(
      params,
      {
        prompt: async (_text, options) => {
          (Reflect.get(store, "db") as Database).exec("PRAGMA query_only = ON");
          options?.preflightResult?.("started");
        },
      },
      async () => ({ text: "draft" }),
      (error) => errors.push(error),
      (intent) =>
        bridge.consume(address, draft.revision, (consumed) =>
          store.intent(intent, consumed ? { ...consumed, owner } : undefined),
        ),
    );
    expect(ledger.lookup(params).state).toBe("accepted");
    expect(bridge.read(address).text).toBe("");
    expect(errors).toHaveLength(1);
    expect(store.snapshot([owner], "new-host").intents[0].receipt.state).toBe(
      "unknown",
    );
    expect(store.snapshot([owner], "new-host").drafts[0].draft.text).toBe(
      "draft",
    );
  });
});

test("a corrupt recovery file is preserved and blocks writes instead of becoming empty state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piris-corrupt-recovery-"));
  const file = join(directory, "recovery.sqlite");
  await writeFile(file, "original invalid bytes");
  const before = await readFile(file);
  const store = new SendRecoveryStore(file);
  try {
    expect(store.error).toContain("existing data preserved");
    expect(() =>
      store.draft(
        address,
        { ...content(), revision: 1 },
        { cwd: directory, sessionFile: null, branchId: null },
      ),
    ).toThrow();
    expect(await readFile(file)).toEqual(before);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unsupported future schema is left byte-for-byte unchanged", async () => {
  await fixture(async ({ file, owner, store }) => {
    store.draft(address, { ...content("preserved"), revision: 1 }, owner);
    (Reflect.get(store, "db") as Database).exec("PRAGMA user_version = 2");
    store.close();
    const before = await readFile(file);
    const future = new SendRecoveryStore(file);
    try {
      expect(future.error).toContain("Unsupported");
      expect(() =>
        future.draft(address, { ...content(), revision: 2 }, owner),
      ).toThrow();
      expect(await readFile(file)).toEqual(before);
    } finally {
      future.close();
    }
  });
});

test("eight maximum-attachment completed sends leave one small durable receipt and accept the next send", async () => {
  await fixture(async ({ owner, store, bridge, ledger }) => {
    const image = {
      type: "image" as const,
      data: "a".repeat(4.5 * 1024 * 1024),
      mimeType: "image/png",
    };
    const heavy = {
      ...content("images"),
      images: Array.from({ length: 8 }, (_, id) => ({ id: String(id), image })),
    };
    const times: number[] = [];
    let first: PromptParams | undefined,
      invocations = 0;
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const draft = bridge.sync({
        ...address,
        expectedRevision: bridge.read(address).revision,
        content: heavy,
      }).draft;
      const params = {
        ...address,
        requestId: String(i),
        draftRevision: draft.revision,
        text: "images",
        images: heavy.images.map((i) => i.image),
      };
      first ??= params;
      ledger.register(params, { owner, content: heavy });
      await ledger.send(
        params,
        {
          prompt: async (_text, options) => {
            invocations++;
            options?.preflightResult?.("handled");
          },
        },
        async () => ({ text: "images" }),
        () => {},
        (intent) =>
          bridge.consume(address, draft.revision, (consumed) =>
            store.intent(intent, consumed ? { ...consumed, owner } : undefined),
          ),
      );
      times.push(performance.now() - start);
      expect(store.snapshot([owner], "new-host").intents).toHaveLength(1);
      expect(
        store.snapshot([owner], "new-host").intents[0].content,
      ).toBeUndefined();
    }
    const saved = store.snapshot([owner], "new-host");
    expect(JSON.stringify(saved).length).toBeLessThan(2_000);
    expect(ledger.lookup(first as PromptParams).state).toBe("accepted");
    expect(invocations).toBe(8);
    const next = bridge.sync({
      ...address,
      expectedRevision: bridge.read(address).revision,
      content: content("next"),
    });
    expect(next.applied).toBe(true);
    console.log(
      JSON.stringify({
        fixture: "8x8x4.5MiB",
        sends: invocations,
        retainedBytes: JSON.stringify(saved).length,
        p95Ms: times.sort((a, b) => a - b)[7],
      }),
    );
  });
}, 60_000);

test("text-only background mirrors reuse durable attachments without inserting/updating images or their references", async () => {
  await fixture(async ({ owner, store, bridge }) => {
    const image = {
      type: "image" as const,
      mimeType: "image/png",
      data: "a".repeat(4.5 * 1024 * 1024),
    };
    bridge.sync({
      ...address,
      expectedRevision: 0,
      content: {
        ...content("initial"),
        images: Array.from({ length: 8 }, (_, id) => ({
          id: String(id),
          image,
        })),
      },
    });
    const db = Reflect.get(store, "db") as Database;
    db.exec(`CREATE TEMP TABLE image_writes (count INTEGER);
      INSERT INTO image_writes VALUES (0);
      CREATE TEMP TRIGGER image_insert AFTER INSERT ON main.images BEGIN UPDATE image_writes SET count=count+1; END;
      CREATE TEMP TRIGGER image_update AFTER UPDATE ON main.images BEGIN UPDATE image_writes SET count=count+1; END;
      CREATE TEMP TRIGGER ref_insert AFTER INSERT ON main.image_refs BEGIN UPDATE image_writes SET count=count+1; END;
      CREATE TEMP TRIGGER ref_delete AFTER DELETE ON main.image_refs BEGIN UPDATE image_writes SET count=count+1; END;`);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = bridge.sync({
        ...address,
        expectedRevision: i + 1,
        keepImages: true,
        content: content(String(i)),
      });
      expect(result.applied).toBe(true);
      times.push(performance.now() - start);
    }
    expect(db.query("SELECT count FROM image_writes").get()).toEqual({
      count: 0,
    });
    expect(store.snapshot([owner], "new").drafts[0].draft.images).toHaveLength(
      8,
    );
    console.log(
      JSON.stringify({
        fixture: "10 text mirrors with 8x4.5MiB retained",
        imageWrites: 0,
        p95Ms: times.sort((a, b) => a - b)[9],
      }),
    );
  });
});

test("closing the owning database blocks late writes while cancelled late hooks cannot recreate receipts", async () => {
  await fixture(async ({ file, owner, store, ledger }) => {
    const params = {
      ...address,
      requestId: "late-hook",
      draftRevision: 1,
      text: "delayed",
    };
    ledger.register(params, { owner, content: content(params.text) });
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const result = ledger.send(
      params,
      {
        prompt: async (_text, options) => {
          entered.resolve();
          await release.promise;
          options?.preflightResult?.("started");
        },
      },
      async () => ({ text: params.text }),
      () => {},
    );
    await entered.promise;
    ledger.cancel(address);
    await expect(result).rejects.toThrow("cancelled");
    store.close();
    release.resolve();
    await ledger.settled();
    expect(ledger.lookup(params).state).toBe("rejected");
    const restarted = new SendRecoveryStore(file);
    try {
      expect(restarted.lookup(params)?.receipt.state).toBe("rejected");
      expect(() =>
        store.draft(address, { ...content("late write"), revision: 2 }, owner),
      ).toThrow();
      expect(restarted.snapshot([owner], "new").intents[0].receipt.state).toBe(
        "rejected",
      );
    } finally {
      restarted.close();
    }
  });
});

test("abrupt host exit at prepared, dispatched and accepted boundaries restores committed data without replay", async () => {
  await fixture(async ({ owner }) => {
    for (const phase of ["prepared", "dispatched", "accepted"] as const) {
      const file = join(owner.cwd, `${phase}.sqlite`);
      const calls = join(owner.cwd, `${phase}.calls`);
      const script = `
        import {writeFileSync} from "node:fs";
        import {SendRecoveryStore} from ${JSON.stringify(new URL("./send-recovery-store.ts", import.meta.url).href)};
        import {ComposerBridge} from ${JSON.stringify(new URL("./composer-bridge.ts", import.meta.url).href)};
        import {SendReceipts} from ${JSON.stringify(new URL("./sdk-send-receipts.ts", import.meta.url).href)};
        const owner = ${JSON.stringify(owner)}, address = ${JSON.stringify(address)};
        const store = new SendRecoveryStore(${JSON.stringify(file)});
        const bridge = new ComposerBridge(()=>{},(a,draft)=>store.draft(a,draft,owner));
        const content = {text:"saved",pastes:[],images:[{id:"image",image:{type:"image",data:"YWJj",mimeType:"image/png"}}]};
        const draft = bridge.sync({...address,expectedRevision:0,content}).draft;
        const params = {...address,requestId:${JSON.stringify(phase)},draftRevision:draft.revision,text:"saved",images:content.images.map(i=>i.image)};
        const ledger = new SendReceipts(address.hostId,store);
        ledger.register(params,{owner,content});
        writeFileSync(${JSON.stringify(calls)},"0");
        if (${JSON.stringify(phase)} === "prepared") process.exit(0);
        await ledger.send(params,{prompt:async (_text,options)=>{
          writeFileSync(${JSON.stringify(calls)},"1");
          if (${JSON.stringify(phase)} === "accepted") options.preflightResult("started");
          process.exit(0);
        }},async()=>({text:"saved"}),()=>{},intent=>bridge.consume(address,draft.revision,consumed=>store.intent(intent,consumed?{...consumed,owner}:undefined)));
      `;
      const child = Bun.spawn([process.execPath, "--eval", script], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(code, stderr).toBe(0);
      expect(await readFile(calls, "utf8")).toBe(
        phase === "prepared" ? "0" : "1",
      );
      const reopened = new SendRecoveryStore(file);
      try {
        const saved = reopened.snapshot([owner], "new-host");
        expect(saved.intents[0].receipt.state).toBe(
          phase === "accepted" ? "accepted" : "unknown",
        );
        expect(saved.drafts[0].draft.text).toBe(
          phase === "accepted" ? "" : "saved",
        );
        expect(saved.drafts[0].draft.images).toHaveLength(
          phase === "accepted" ? 0 : 1,
        );
        const ledger = new SendReceipts("new-host", reopened);
        let invocations = 0;
        const params = {
          ...address,
          requestId: phase,
          draftRevision: 1,
          text: "saved",
          images: [
            { type: "image" as const, data: "YWJj", mimeType: "image/png" },
          ],
        };
        await ledger
          .send(
            params,
            {
              prompt: async () => {
                invocations++;
              },
            },
            async () => ({ text: "saved" }),
            () => {},
          )
          .catch(() => {});
        expect(invocations).toBe(0);
      } finally {
        reopened.close();
      }
    }
  });
});

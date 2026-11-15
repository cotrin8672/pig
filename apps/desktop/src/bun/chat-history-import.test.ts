import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChatHistoryWorker } from "../../scripts/pre-build";
import { IMPORTED_HISTORY_PROVIDER } from "../shared/chat-history-import";
import { responseStats } from "../shared/transcript";
import { ChatHistoryImports } from "./chat-history-import";
import { SessionManager } from "./sdk";

const fixture = [
  {
    id: "chatgpt",
    title: "Two branches",
    current_node: "a",
    mapping: {
      q: {
        parent: null,
        message: {
          author: { role: "user" },
          content: { parts: ["Question"] },
          create_time: 10,
        },
      },
      a: {
        parent: "q",
        message: {
          author: { role: "assistant" },
          content: { parts: ["Active answer"] },
          create_time: 20,
        },
      },
      b: {
        parent: "q",
        message: {
          author: { role: "assistant" },
          content: { parts: ["Other answer"] },
          create_time: 30,
        },
      },
    },
  },
  {
    uuid: "claude",
    name: "Second chat",
    chat_messages: [
      {
        uuid: "u",
        sender: "human",
        text: "Only this chat",
        created_at: "2024-01-01T00:00:00Z",
      },
    ],
  },
];

test("imports only selected conversations, reopens the active branch, then imports all without duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-history-import-"));
  const service = new ChatHistoryImports();
  try {
    const file = join(root, "conversations.json");
    const dir = join(root, "sessions");
    await writeFile(file, JSON.stringify(fixture));
    const preview = await service.prepare(file);
    expect(preview.conversations.map((item) => item.title)).toEqual([
      "Two branches",
      "Second chat",
    ]);
    expect("nodes" in preview.conversations[0]).toBe(false);
    await expect(
      service.import({ previewId: "foreign-plan", cwd: root, ids: null }, dir),
    ).rejects.toThrow("again");
    await expect(
      service.import(
        { previewId: preview.id, cwd: root, ids: ["foreign"] },
        dir,
      ),
    ).rejects.toThrow("Choose conversations");
    await expect(
      service.import({ previewId: preview.id, cwd: root, ids: [] }, dir),
    ).rejects.toThrow("Choose conversations");
    expect(
      await service.import(
        { previewId: preview.id, cwd: root, ids: ["0"] },
        dir,
      ),
    ).toEqual({ copied: 1, skipped: 0, failed: 0 });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const manager = SessionManager.open(join(dir, files[0]));
    expect(manager.getSessionName()).toBe("Two branches");
    expect(manager.getLeafEntry()?.timestamp).toBe(
      new Date(30000).toISOString(),
    );
    expect(
      manager.getEntries().filter((entry) => entry.type === "message"),
    ).toHaveLength(3);
    const context = manager.buildSessionContext();
    const messages = context.messages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    );
    expect(messages.map((message) => message.content)).toEqual([
      "Question",
      [{ type: "text", text: "Active answer" }],
    ]);
    const answer = context.messages[1];
    expect(answer.role).toBe("assistant");
    if (answer.role !== "assistant")
      throw new Error("Missing imported assistant");
    expect(answer.provider).toBe(IMPORTED_HISTORY_PROVIDER);
    expect(
      responseStats(
        messages.map((message) => ({ message })),
        1,
      ),
    ).toMatchObject({ imported: true, durationMs: 0, text: "Active answer" });
    expect(answer.timestamp).toBe(20000);
    expect(context.model?.provider).toBe(IMPORTED_HISTORY_PROVIDER);
    expect(
      manager.getEntries().some((entry) => entry.type === "model_change"),
    ).toBe(false);
    const before = await readFile(join(dir, files[0]), "utf8");
    expect(
      await service.import(
        { previewId: preview.id, cwd: root, ids: null },
        dir,
      ),
    ).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect(await readFile(join(dir, files[0]), "utf8")).toBe(before);
    expect(
      (await readdir(dir)).filter((file) => file.endsWith(".tmp")),
    ).toHaveLength(0);
    service.clear();
    await expect(
      service.import({ previewId: preview.id, cwd: root, ids: null }, dir),
    ).rejects.toThrow("again");
  } finally {
    service.clear();
    await rm(root, { recursive: true, force: true });
  }
});

test("parallel windows publish once; different projects keep independent copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-history-parallel-"));
  const left = new ChatHistoryImports();
  const right = new ChatHistoryImports();
  try {
    const file = join(root, "conversations.json");
    await writeFile(file, JSON.stringify(fixture[1]));
    const [a, b] = await Promise.all([left.prepare(file), right.prepare(file)]);
    const dir = join(root, "shared");
    const results = await Promise.all([
      left.import({ previewId: a.id, cwd: root, ids: null }, dir),
      right.import({ previewId: b.id, cwd: root, ids: null }, dir),
    ]);
    expect(results.reduce((sum, result) => sum + result.copied, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
    expect(
      await right.import(
        { previewId: b.id, cwd: join(root, "another-project"), ids: null },
        dir,
      ),
    ).toMatchObject({ copied: 1 });
    expect(await readdir(dir)).toHaveLength(2);
  } finally {
    left.clear();
    right.clear();
    await rm(root, { recursive: true, force: true });
  }
});

test("an export reports per-chat failures with their cause and continues the batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-history-failure-"));
  const service = new ChatHistoryImports();
  try {
    const file = join(root, "conversations.json");
    await writeFile(file, JSON.stringify(fixture));
    const preview = await service.prepare(file);
    const fail = spyOn(SessionManager, "inMemory").mockImplementationOnce(
      () => {
        throw new Error("The session could not be created.");
      },
    );
    try {
      const result = await service.import(
        { previewId: preview.id, cwd: root, ids: null },
        join(root, "sessions"),
      );
      expect(result).toEqual({
        copied: 1,
        skipped: 0,
        failed: 1,
        errors: [
          {
            id: "0",
            title: "Two branches",
            message: "The session could not be created.",
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain("Active answer");
    } finally {
      fail.mockRestore();
    }
  } finally {
    service.clear();
    await rm(root, { recursive: true, force: true });
  }
});

test("worker failures and oversized files do not expose a preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-history-invalid-"));
  const service = new ChatHistoryImports();
  try {
    const file = join(root, "bad.json");
    await writeFile(file, '{"private secret"');
    await expect(service.prepare(file)).rejects.toThrow("Invalid JSON.");
    await writeFile(file, " ".repeat(32 * 1024 * 1024 + 1));
    await expect(service.prepare(file)).rejects.toThrow("32 MiB");
    await expect(service.prepare(join(root, "missing"))).rejects.toThrow(
      "Could not read",
    );
  } finally {
    service.clear();
    await rm(root, { recursive: true, force: true });
  }
});

test("the packaged worker parses exports without relying on source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-history-worker-"));
  try {
    await buildChatHistoryWorker(join(import.meta.dir, "../.."));
    const file = join(root, "conversations.json");
    await writeFile(file, JSON.stringify(fixture));
    const worker = new Worker(
      new URL(
        "../../build/chat-history/chat-history-worker.js",
        import.meta.url,
      ).href,
    );
    try {
      const result = await new Promise<{
        parsed: { conversations: unknown[] };
      }>((resolve, reject) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.onerror = reject;
        worker.postMessage(file);
      });
      expect(result.parsed.conversations).toHaveLength(2);
    } finally {
      worker.terminate();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an imported chat resumes with a destination model, not its source provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-history-resume-"));
  try {
    const file = join(home, "conversations.json");
    await writeFile(file, JSON.stringify(fixture[0]));
    const script = `
      import {expect} from "bun:test";
      import {fauxProvider} from "@earendil-works/pi-ai";
      import {ChatHistoryImports} from ${JSON.stringify(new URL("./chat-history-import.ts", import.meta.url).href)};
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {SessionManager} from ${JSON.stringify(new URL("./sdk.ts", import.meta.url).href)};
      const cwd=${JSON.stringify(home)};
      const imports=new ChatHistoryImports();
      const preview=await imports.prepare(${JSON.stringify(file)});
      expect((await imports.import({previewId:preview.id,cwd,ids:null})).copied).toBe(1);
      const info=(await SessionManager.list(cwd))[0];
      const faux=fauxProvider({tokensPerSecond:Infinity,models:[{id:"destination"}]});
      const host=new SessionHost({
        modelInfo:m=>({id:m.id,provider:m.provider,name:m.name}),
        configureModels:m=>{m.registerNativeProvider(faux.provider);},
        emit(){},emitUI(){},emitTerminal(){},
      });
      host.connectUI({clientId:"history-test"});
      try {
        await host.openSession({cwd,id:info.id,openId:"imported"});
        const session=host.session(info.id);
        expect(session.model.provider).toBe(faux.getModel().provider);
        expect(session.model.id).toBe("destination");
        const before=session.sessionManager.buildSessionContext().messages;
        expect(before.filter(m=>m.role==="assistant")[0].content).toEqual([{type:"text",text:"Active answer"}]);
        await session.prompt("Continue this conversation");
        const after=session.sessionManager.buildSessionContext().messages;
        expect(after.at(-1).role).toBe("assistant");
        expect(after.at(-1).provider).toBe(faux.getModel().provider);
        expect(after.filter(m=>m.role==="toolResult")).toHaveLength(0);
      } finally {
        imports.clear();
        await host.dispose();
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: join(home, "agent"),
        PI_CODING_AGENT_SESSION_DIR: "",
        PI_OFFLINE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

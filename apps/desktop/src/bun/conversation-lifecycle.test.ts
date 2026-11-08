import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The app runtime is module-global: exercise real JSONL and RPC-facing services
// in an isolated process, never opening the developer's chat/config directory.
test("same-ID rewind, edit, archive, fork-safe purge, active-run refusal and reopen", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-lifecycle-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { readFile, readdir } from "node:fs/promises";
      import { join } from "node:path";
      import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import * as app from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import { DesktopStateStore } from ${JSON.stringify(new URL("./desktop-state.ts", import.meta.url).href)};
      import { sessionLink, sessionIdFromLink } from ${JSON.stringify(new URL("../shared/session-links.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider({tokensPerSecond: Infinity});
      app.runtime.clearProviders(); app.runtime.setProvider(faux.provider);
      const events = [];
      const chat = await app.openSession({cwd}, (id, event) => events.push({id, event}));
      const id = chat.info.id;
      const input = {cwd, id};
      const snapshot = () => app.openSession(input, () => {});
      const state = new DesktopStateStore(join(cwd, "desktop.json"));
      await state.setSession(id, {pinned: true, archived: true});
      await state.completeSession(id, "success");
      await state.markSessionRead(id, state.value.sessions[id].completion.id);
      const flags = structuredClone(state.value);
      expect(sessionIdFromLink(sessionLink(id))).toBe(id);
      const send = async (text, answer) => {
        faux.setResponses([fauxAssistantMessage(answer)]);
        await app.promptSession(id, text, crypto.randomUUID());
        await (await app.durable()).harness.waitForIdle(context);
        await new Promise(resolve => setTimeout(resolve, 20));
      };
      await send("first", "first answer");
      await new Promise(resolve => setTimeout(resolve, 2));
      await send("second", "old answer");
      const before = await snapshot();
      const user = before.transcript.turns.find(t => t.message.role === "user" && t.message.content === "second").message;
      const answer = before.transcript.turns.at(-1).message;
      const fork = await app.forkSession(id, answer.timestamp);
      const forkHistory = await (await app.durable()).history(fork.id);
      await new Promise(resolve => setTimeout(resolve, 2));
      await send("third", "discard me");
      await app.renameSession(chat.info, "Kept name");
      expect((await app.rewindSession(id, user.timestamp)).id).toBe(id);
      expect((await snapshot()).transcript.turns.map(t => t.message.content)).toEqual(["first", before.transcript.turns[1].message.content]);
      await send("edited second", "new answer");
      let after = await snapshot();
      expect(after.info.id).toBe(id);
      expect(after.transcript.turns).toHaveLength(4);
      expect(after.transcript.turns[2].message.content).toBe("edited second");
      expect(JSON.stringify(after.transcript)).toContain("new answer");
      expect(JSON.stringify(after.transcript)).not.toContain("old answer");
      expect(JSON.stringify(after.transcript)).not.toContain("discard me");
      expect(after.info.title).toBe("Kept name");
      expect(JSON.stringify(events.at(-1))).toContain("new answer");
      expect(JSON.stringify(events.at(-1))).not.toContain("old answer");
      // Repeating regeneration after retained metadata must not revive old turns.
      await app.rewindSession(id, after.transcript.turns[2].message.timestamp);
      const rewoundContext = await (await (await app.durable()).conversation(id)).context(context);
      expect(JSON.stringify(rewoundContext.messages)).toContain("first answer");
      expect(JSON.stringify(rewoundContext.messages)).not.toContain("old answer");
      expect(JSON.stringify(rewoundContext.messages)).not.toContain("third");
      await send("edited second", "new answer");
      after = await snapshot();
      const service = await app.durable();
      const modelContext = await (await service.conversation(id)).context(context);
      expect(JSON.stringify(modelContext.messages)).toContain("first answer");
      expect(JSON.stringify(modelContext.messages)).toContain("new answer");
      expect(JSON.stringify(modelContext.messages)).not.toContain("old answer");
      expect(JSON.stringify(modelContext.messages)).not.toContain("third");
      expect(await service.history(fork.id)).toEqual(forkHistory);
      expect(await state.settled()).toEqual(flags);
      expect((await app.listSessions(cwd)).some(item => item.id === id)).toBe(true);
      await app.closeSession(id);
      expect((await snapshot()).transcript.turns).toEqual(after.transcript.turns);
      // Rewind the first turn too, after a prior rewind and reopen.
      const firstUser = after.transcript.turns[0].message;
      await app.rewindSession(id, firstUser.timestamp);
      expect((await snapshot()).transcript.turns).toHaveLength(0);
      await send("replacement first", "replacement answer");
      expect((await snapshot()).transcript.turns).toHaveLength(2);
      await expect(app.deleteSession(chat.info)).rejects.toThrow("children first");
      expect((await snapshot()).transcript.turns).toHaveLength(2);
      // An active task is refused, not tombstoned and not silently aborted.
      let started;
      const running = new Promise(resolve => {started = resolve;});
      faux.setResponses([async (_messages, options) => {
        started();
        await new Promise(resolve => {
          options.signal.addEventListener("abort", resolve, {once: true});
          if (options.signal.aborted) resolve();
        });
        return fauxAssistantMessage("aborted");
      }]);
      await app.promptSession(id, "running", "active-delete");
      await running;
      await expect(app.deleteSession(chat.info)).rejects.toThrow("Stop active chats");
      await app.abortSession(id);
      await (await app.durable()).harness.waitForIdle(context);
      // Purge leaf first; inherited parent entries must survive leaf deletion.
      await app.deleteSession({cwd, id: fork.id, title: "fork", modified: 0});
      await expect((await app.durable()).conversation(fork.id)).rejects.toThrow("not found");
      expect((await snapshot()).info.id).toBe(id);
      await app.deleteSession(chat.info);
      await expect((await app.durable()).conversation(id)).rejects.toThrow("not found");
      expect(await app.listSessions(cwd)).toEqual([]);
      const dir = join(cwd, ".config", "pig", "durable");
      const main = await readFile(join(dir, "main.jsonl"), "utf8");
      expect(main).not.toContain("replacement first");
      expect(main).not.toContain("first answer");
      expect(main).not.toContain("pig.deleted");
      const fresh = await app.openSession({cwd}, () => {});
      expect(Number(fresh.info.id)).toBeGreaterThan(Number(fork.id));
      expect(sessionIdFromLink(sessionLink(fresh.info.id))).toBe(fresh.info.id);
      // The purge reopens the Harness; reopen once more independently from disk.
      await app.disposeSessions();
      const { DurableService } = await import(${JSON.stringify(new URL("./durable-service.ts", import.meta.url).href)});
      const reopened = await DurableService.open(app.runtime, dir);
      await expect(reopened.conversation(id)).rejects.toThrow("not found");
      await expect(reopened.conversation(fork.id)).rejects.toThrow("not found");
      expect((await reopened.list(cwd)).map(item => item.id)).toEqual([fresh.info.id]);
      await reopened.close();
      expect((await readdir(dir)).filter(name => name.endsWith(".purge"))).toEqual([]);
      expect(await state.settled()).toEqual(flags);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shells = process.platform === "win32" ? ["bash", "powershell"] : ["bash"];

test.each(
  shells,
)("real SDK collects %s classifications, failures and usage without leaking bodies or double counting", async (shellName) => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-host-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { Database } from "bun:sqlite";
      import { join } from "node:path";
      import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import { modelInfo, disposeSessions } from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import { StatisticsService } from ${JSON.stringify(new URL("./statistics/service.ts", import.meta.url).href)};
      import { defaultSettings } from ${JSON.stringify(new URL("../shared/settings.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(root)};
      const shellName = ${JSON.stringify(shellName)};
      const file = join(cwd, "statistics.sqlite");
      const statistics = new StatisticsService(file);
      const faux = fauxProvider({ tokensPerSecond: Infinity, models: [{ id: "fixture", input: ["text"] }] });
      const host = new SessionHost({
        modelInfo, statistics, recoveryFile: join(cwd, "recovery.sqlite"),
        settings: () => ({ ...defaultSettings, shell: shellName === "powershell" ? "powershell" : "git-bash" }),
        configureModels: runtime => runtime.registerNativeProvider(faux.provider),
        emit() {}, emitTerminal() {}, emitUI(event) {
          if (event.type === "request" && event.request.kind === "project-trust")
            queueMicrotask(() => host.resolveExtensionUI({ ...event.request, value: "once" }));
        },
      });
      host.connectUI({ clientId: "root" });
      let chat = await host.openSession({ cwd, openId: "statistics" });
      await host.setModel({ ...chat.address, provider: faux.getModel().provider, id: faux.getModel().id });
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("read", { path: "SECRET-nonexistent-file" }), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("read", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall(shellName, { command: "exit 7" }), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall(shellName, { command: "git diff --no-index -- 'SECRET-left' 'SECRET-right'" }), { stopReason: "toolUse" }),
        fauxAssistantMessage("SECRET-response"),
      ]);
      await host.prompt({
        ...chat.address, requestId: "send", text: "SECRET-prompt",
        draftRevision: host.drafts.read(chat.address).revision,
      });
      await host.receipts.settled();
      await statistics.flush();
      const db = new Database(file, { readonly: true });
      expect(db.query("SELECT count(*) AS n FROM model_requests").get()).toEqual({ n: 5 });
      const tool = db.query("SELECT data, request FROM events WHERE type = 'tool_execution_end'").get();
      expect(JSON.parse(tool.data).isError).toBe(true);
      expect(tool.request).toBeString();
      const shell = db.query("SELECT data FROM events WHERE type = 'tool_execution_end' AND json_extract(data, '$.tool') = ? AND json_extract(data, '$.exitCode') = 7").get(shellName);
      expect(JSON.parse(shell.data)).toMatchObject({ isError: true, exitCode: 7, shellCommandKey: "unclassified" });
      const classified = db.query("SELECT data FROM events WHERE type = 'tool_execution_end' AND json_extract(data, '$.shellCommandKey') = 'git diff'").get();
      const classifiedData = JSON.parse(classified.data);
      expect(classifiedData).toMatchObject({ tool: shellName, isError: true, shellCommandKey: "git diff" });
      expect(classifiedData.exitCode).toBeGreaterThan(0);
      expect(db.query("SELECT count(*) AS n FROM events WHERE type = 'tool_execution_end' AND json_extract(data, '$.executionObserved') = 0").get()).toEqual({ n: 1 });
      const start = db.query("SELECT data FROM events WHERE type = 'binding_open' LIMIT 1").get();
      expect(JSON.parse(start.data).coverage.finalPayload).toBe("unobserved");
      const data = JSON.stringify(db.query("SELECT * FROM events").all());
      expect(data).not.toContain("SECRET");
      expect(db.query("SELECT count(*) AS n FROM events WHERE type = 'initial_context'").get()).toEqual({ n: 1 });
      const aggregate = await statistics.snapshot("today");
      expect(aggregate.models[0].requests).toBe(5);
      expect(aggregate.initialContext.parts.some(part => part.id === "tools")).toBe(true);
      chat = host.getSessionSnapshot(chat.address);
      const last = chat.transcript.records.filter(r => r.kind === "message" && r.message.role === "assistant").at(-1);
      const fork = await host.forkSession({ ...chat.address, entryId: last.entryId });
      await statistics.flush();
      expect(db.query("SELECT count(*) AS n FROM model_requests").get()).toEqual({ n: 5 });
      await host.deleteSession(chat.info);
      await statistics.flush();
      expect(db.query("SELECT count(*) AS n FROM model_requests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT count(*) AS n FROM events WHERE json_type(data, '$.shellCommandKey') IS NOT NULL").get()).toEqual({ n: 0 });
      await host.closeSession(fork.address);
      await host.dispose();
      await statistics.close();
      db.close();
      await disposeSessions();
    `;
    const child = Bun.spawn(
      [process.execPath, "--no-install", "--eval", script],
      {
        cwd: join(import.meta.dir, "../.."),
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          PI_OFFLINE: "1",
          PIG_STATISTICS: "0",
          PI_CODING_AGENT_DIR: join(root, "profile"),
          PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

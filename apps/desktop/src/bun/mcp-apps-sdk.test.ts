import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SDK MCP Apps bridge reuses authenticated connections for direct/deferred/codemode and honours replacement", async () => {
  const home = await mkdtemp(join(tmpdir(), "piris-mcp-apps-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir, writeFile, rm} from "node:fs/promises";
      import {join} from "node:path";
      import {fauxProvider, fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import {mcpAppRef} from ${JSON.stringify(new URL("../shared/mcp-app.ts", import.meta.url).href)};
      const home = ${JSON.stringify(home)};
      const uri = "ui://fixture/chart.html";
      let starts = 0, reads = 0, calls = 0, initialized;
      const server = Bun.serve({port: 0, hostname: "127.0.0.1", async fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer fixture-secret");
        if (request.method !== "POST") return new Response(null, {status: 405});
        const message = await request.json();
        if (!("id" in message)) return new Response(null, {status: 202});
        let result;
        switch (message.method) {
          case "initialize":
            starts++; initialized = message.params;
            result = {protocolVersion: message.params.protocolVersion,
              capabilities: {tools: {}, resources: {}},
              serverInfo: {name: "fixture", version: "1"}};
            break;
          case "tools/list":
            result = {tools: [{name: "forecast", title: "Forecast", description: "forecast chart",
              inputSchema: {type: "object", properties: {}},
              _meta: {ui: {resourceUri: uri}}}]};
            break;
          case "tools/call":
            calls++;
            result = {content: [{type: "text", text: "Forecast: 20 degrees"}],
              structuredContent: {temperature: 20}, _meta: {privateToken: "never-forward-this"}};
            break;
          case "resources/read":
            reads++; expect(message.params.uri).toBe(uri);
            await Bun.sleep(10);
            result = {contents: [{uri, mimeType: "text/html;profile=mcp-app",
              text: "<!doctype html><h1>Static forecast</h1><script>mustNotRun()</script>"}]};
            break;
          default:
            return Response.json({jsonrpc: "2.0", id: message.id, error: {code: -32601, message: "Unknown method"}});
        }
        return Response.json({jsonrpc: "2.0", id: message.id, result});
      }});
      const faux = fauxProvider({tokensPerSecond: Infinity});
      await mkdir(join(home, "extensions"), {recursive: true});
      await writeFile(join(home, "extensions", "permissions.ts"), \`
        export default pi => {
          pi.on("tool_call", event => {
            if (globalThis.__denyMcp && event.toolName === "mcp__fixture__forecast")
              return {block: true, reason: "permission fixture"};
          });
        };
      \`);
      const hosts = [];
      const createHost = () => {
        const host = new SessionHost({modelInfo,
          configureModels: m => m.registerNativeProvider(faux.provider),
          emit() {}, emitTerminal() {},
          emitUI(e) {
            if (e.type === "request" && e.request.kind === "project-trust")
              queueMicrotask(() => host.resolveExtensionUI({...e.request, value: "once"}));
          }});
        host.connectUI({clientId: "root"}); hosts.push(host); return host;
      };
      try {
        for (const exposure of ["direct", "deferred", "codemode"]) {
          await writeFile(join(home, "mcp.json"), JSON.stringify({mcpServers: {fixture: {
            url: "http://127.0.0.1:" + server.port + "/mcp",
            headers: {Authorization: "Bearer fixture-secret"}, exposure,
          }}}));
          const startsBeforeOpen = starts;
          const readsBeforeOpen = reads;
          const host = createHost();
          const chat = await host.openSession({cwd: home, openId: exposure});
          await host.setModel({...chat.address, provider: faux.getModel().provider, id: faux.getModel().id});
          const session = host.session(chat.info.id);
          const events = [];
          session.subscribe(e => {if (e.type === "tool_execution_end") events.push(e);});
          const done = transcript => {
            const modelInput = JSON.stringify(transcript);
            expect(modelInput).not.toContain("never-forward-this");
            expect(modelInput).not.toContain("mcpApp");
            expect(modelInput).not.toContain(uri);
            return fauxAssistantMessage("done");
          };
          const responses = () => {
            const direct = fauxAssistantMessage(fauxToolCall("mcp__fixture__forecast", {}), {stopReason: "toolUse"});
            const code = fauxAssistantMessage(fauxToolCall("codemode", {
              code: "return await tools.mcp__fixture__forecast({});"
            }), {stopReason: "toolUse"});
            return exposure === "deferred"
              ? [fauxAssistantMessage(fauxToolCall("tool_search", {query: "forecast"}), {stopReason: "toolUse"}), direct, done]
              : [exposure === "codemode" ? code : direct, done];
          };
          const send = async (address, text) => {
            await host.prompt({...address, requestId: crypto.randomUUID(), text,
              draftRevision: host.drafts.read(address).revision});
            await host.receipts.settled();
          };
          faux.setResponses(responses());
          await send(chat.address, "forecast");
          const result = events.find(e => e.toolName === "mcp__fixture__forecast");
          expect(result?.isError).toBe(false);
          const ref = mcpAppRef(result.result.details);
          expect(ref?.title).toBe("Forecast");
          expect(JSON.stringify(result.result)).not.toContain("never-forward-this");
          expect(JSON.stringify(result.result.structuredContent)).not.toContain("mcpApp");
          if (exposure === "codemode") expect(result.parentToolCallId).toBeTruthy();
          // Lazy: nothing is fetched until a preview is requested.
          expect(reads).toBe(readsBeforeOpen);
          expect(initialized.capabilities.extensions?.["io.modelcontextprotocol/ui"]).toBeUndefined();
          expect(starts).toBe(startsBeforeOpen + 1);
          const input = {...chat.address, appId: ref.id, toolCallId: result.toolCallId};
          const [a, b] = await Promise.all([host.getMcpAppPreview(input), host.getMcpAppPreview(input)]);
          expect(a?.html).toContain("Static forecast");
          expect(a.html).not.toContain("<script");
          expect(b).toEqual(a);
          expect(reads).toBe(readsBeforeOpen + 1);
          // Same authenticated connection; no second client.
          expect(starts).toBe(startsBeforeOpen + 1);
          expect(await host.getMcpAppPreview({...input, toolCallId: "other"})).toBeNull();
          const callsBeforeDenial = calls;
          globalThis.__denyMcp = true;
          faux.setResponses([
            fauxAssistantMessage(fauxToolCall("mcp__fixture__forecast", {}), {stopReason: "toolUse"}), done,
          ]);
          await send(chat.address, "denied");
          globalThis.__denyMcp = false;
          const denied = events.filter(e => e.toolName === "mcp__fixture__forecast").at(-1);
          expect(denied.isError).toBe(true);
          expect(mcpAppRef(denied.result.details)).toBeUndefined();
          expect(calls).toBe(callsBeforeDenial);
          await session.prompt("/mcp reconnect fixture");
          expect(starts).toBe(startsBeforeOpen + 2);
          expect(await host.getMcpAppPreview(input)).toBeNull();
          await host.reloadSession(chat.address);
          const next = host.sessionAddress(chat.info.id);
          expect(next.epoch).toBeGreaterThan(chat.address.epoch);
          expect(await host.getMcpAppPreview({...input, ...next})).toBeNull();
          expect(await host.getMcpAppPreview(input)).toBeNull();
          await host.closeSession(next);
          await host.dispose();
        }
        // A replacement MCP extension must not accidentally start a second built-in client.
        const startsBefore = starts;
        await mkdir(join(home, "extensions"), {recursive: true});
        await writeFile(join(home, "extensions", "replacement.ts"),
          'export default pi => pi.registerCommand("mcp", {description:"replacement", handler:async()=>{}})');
        let host = createHost();
        let chat = await host.openSession({cwd: home, openId: "replacement"});
        await Bun.sleep(20);
        expect(starts).toBe(startsBefore);
        expect(host.listSlashCommands(chat.address)).toContainEqual({
          name: "mcp", description: "replacement", category: "extension"
        });
        await host.dispose();
        await rm(join(home, "extensions"), {recursive: true});
        await writeFile(join(home, "settings.json"), JSON.stringify({extensions: ["-builtin:mcp"]}));
        host = createHost();
        chat = await host.openSession({cwd: home, openId: "disabled"});
        await Bun.sleep(20);
        expect(starts).toBe(startsBefore);
        expect(host.listSlashCommands(chat.address).some(c => c.name === "mcp")).toBe(false);
        await host.dispose();
        console.log(JSON.stringify({exposures: 3, calls, lazyReads: reads, replacementAndDisable: true}));
      } finally {
        for (const host of hosts) await host.dispose();
        await disposeSessions(); server.stop(true);
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: home,
        PI_OFFLINE: "1",
      },
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
}, 60_000);

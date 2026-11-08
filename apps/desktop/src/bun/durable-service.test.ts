import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ConversationView } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { DEFAULT_IMAGE_LIMITS } from "@earendil-works/pi-durable/tools";
import { defaultSettings, type Settings } from "../shared/settings";
import {
  blockedImageNote,
  DurableService,
  resolveGitBash,
  resolvePowerShell,
  shellCommand,
} from "./durable-service";

test("Git Bash resolves PATH and per-user installs and preserves default fallback", () => {
  const bash = "D:\\PortableGit\\usr\\bin\\bash.exe";
  for (const git of [
    "D:\\PortableGit\\cmd\\git.exe",
    "D:\\PortableGit\\bin\\git.exe",
    "D:\\PortableGit\\mingw64\\bin\\git.exe",
  ])
    expect(resolveGitBash({}, git, (path) => path === bash)).toBe(bash);
  const local = "C:\\Users\\test\\AppData\\Local";
  const userBash = `${local}\\Programs\\Git\\usr\\bin\\bash.exe`;
  expect(
    resolveGitBash({ LOCALAPPDATA: local }, null, (path) => path === userBash),
  ).toBe(userBash);
  const systemBash = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
  expect(
    resolveGitBash(
      { ProgramFiles: "C:\\Program Files" },
      null,
      (path) => path === systemBash,
    ),
  ).toBe(systemBash);
  expect(resolveGitBash({}, null, () => false)).toBeUndefined();
  expect(
    resolveGitBash({ LOCALAPPDATA: local }, "D:\\Other\\git.exe", () => false),
  ).toBeUndefined();
});
const directories: string[] = [];
const services: DurableService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function setup(settings: () => Settings = () => defaultSettings) {
  const home = await mkdtemp(join(tmpdir(), "pig-durable-"));
  directories.push(home);
  const directory = join(home, ".config", "pig", "durable");
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels();
  models.setProvider(faux.provider);
  const service = await DurableService.open(models, directory, {
    settings,
    resourceDir: home,
  });
  services.push(service);
  const model = faux.getModel();
  const conversation = await service.create(home, {
    provider: model.provider,
    modelId: model.id,
  });
  return { home, directory, faux, models, service, conversation };
}

function assistantText(view: ConversationView) {
  return view.entries
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

test("Durable create, submit, watch, list, reopen, request id deduplication and fork", async () => {
  const { home, directory, faux, models, service, conversation } =
    await setup();
  faux.setResponses([fauxAssistantMessage("Hello from Durable")]);
  const watch = await service.watch(conversation.id);
  const reply = new Promise<void>((resolve) => {
    watch.start(async (call) => {
      if (
        call.kind === "value" &&
        assistantText(call.value).includes("Hello from Durable")
      )
        resolve();
    });
  });
  const submission = await service.submit(
    conversation.id,
    "Hello",
    "request-1",
  );
  expect((await submission.wait(context)).status).toBe("done");
  await reply;
  await watch.stop();
  expect(await service.list(home)).toMatchObject([
    { id: String(conversation.id), title: "Hello" },
  ]);
  const original = await service.history(conversation.id);
  const answer = original.find((entry) => entry.kind === "pi.assistant");
  expect(answer).toBeDefined();
  if (!answer) throw new Error("Missing answer");
  const fork = await service.fork(conversation.id, answer.id);
  expect(await service.history(fork.id)).toEqual(original);
  faux.setResponses([fauxAssistantMessage("Fork answer")]);
  await (await service.submit(fork.id, "Only on fork", "fork-1")).wait(context);
  expect(await service.history(conversation.id)).toEqual(original);
  await service.close();
  services.splice(services.indexOf(service), 1);
  const reopened = await DurableService.open(models, directory);
  services.push(reopened);
  expect(
    (await reopened.list(home)).some(
      (item) => item.id === String(conversation.id),
    ),
  ).toBe(true);
  expect(await reopened.history(conversation.id)).toEqual(original);
  const again = await reopened.submit(conversation.id, "Hello", "request-1");
  expect(again.id).toBe(submission.id);
  expect(await reopened.history(conversation.id)).toEqual(original);
  expect(existsSync(join(home, ".pi", "agent"))).toBe(false);
}, 15_000);

test("abort in-flight generation settles without an answer", async () => {
  const { service, conversation, faux, home } = await setup();
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  faux.setResponses([
    async (_transcript, options) => {
      started();
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
        if (options?.signal?.aborted) resolve();
      });
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  const submission = await service.submit(conversation.id, "Wait", "abort-1");
  await running;
  await service.abort(conversation.id);
  const receipt = await submission.wait(context);
  expect(receipt.status).toBe("unanswered");
  expect(receipt.reason).toBe("aborted");
  expect(existsSync(join(home, ".pi", "agent"))).toBe(false);
}, 15_000);

test("submission rejected before acceptance propagates an error and writes no input", async () => {
  const { service, conversation } = await setup();
  await expect(
    service.admit(conversation.id, {
      type: "input",
      content: "Must not be written",
      requestId: "reject-1",
      whenIdle: "reject",
    }),
  ).rejects.toThrow();
  expect(
    (await service.history(conversation.id)).filter(
      (entry) => entry.kind === "pi.user",
    ),
  ).toHaveLength(0);
  await expect(service.submit(conversation.id, "", "empty-1")).rejects.toThrow(
    "empty",
  );
});

test("built-in coding tools execute against the project directory under Bun", async () => {
  const { service, conversation, faux, home } = await setup();
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "fixture.txt", content: "before" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("edit", {
        path: "fixture.txt",
        edits: [{ oldText: "before", newText: "after" }],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: "fixture.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "echo ok", timeout: 10 }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Tools finished"),
  ]);
  const submission = await service.submit(
    conversation.id,
    "Exercise tools",
    "tools-1",
  );
  expect((await submission.wait(context)).status).toBe("done");
  expect(await readFile(join(home, "fixture.txt"), "utf8")).toBe("after");
  const results = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "toolResult");
  expect(results).toHaveLength(4);
  expect(results.filter((result) => result.isError)).toEqual([]);
  expect(existsSync(join(home, ".pi", "agent"))).toBe(false);
}, 15_000);

test("PowerShell resolution prefers pwsh and reports missing executables; shell argv is explicit", () => {
  expect(resolvePowerShell((name) => `C:/${name}`)).toBe("C:/pwsh.exe");
  expect(
    resolvePowerShell((name) =>
      name === "powershell.exe" ? "C:/powershell.exe" : null,
    ),
  ).toBe("C:/powershell.exe");
  expect(() => resolvePowerShell(() => null)).toThrow(
    "neither pwsh.exe nor powershell.exe",
  );
  expect(shellCommand("powershell", "pwsh.exe", "Write-Output hi")).toEqual([
    "pwsh.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Write-Output hi",
  ]);
  expect(shellCommand("git-bash", "bash.exe", "echo hi")).toEqual([
    "bash.exe",
    "-c",
    "echo hi",
  ]);
});

test.skipIf(process.platform !== "win32")(
  "bash tool executes real PowerShell and prompt identifies its syntax",
  async () => {
    const settings = { ...defaultSettings, shell: "powershell" as const };
    const { service, conversation, faux } = await setup(() => settings);
    faux.setResponses([
      (transcript) => {
        expect(JSON.stringify(transcript)).toContain("Use PowerShell syntax");
        return fauxAssistantMessage(
          fauxToolCall("bash", { command: "Write-Output hi" }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("done"),
    ]);
    expect(
      (
        await (
          await service.submit(conversation.id, "test shell", "powershell-1")
        ).wait(context)
      ).status,
    ).toBe("done");
    const results = (await service.history(conversation.id))
      .flatMap((entry) => entry.model ?? [])
      .filter((message) => message.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBeFalsy();
    expect(JSON.stringify(results[0]?.content)).toContain("hi");
  },
  15_000,
);

test("blockImages strips submitted input and read-tool image output, and changes apply live", async () => {
  let settings = { ...defaultSettings, blockImages: true };
  const { service, conversation, faux, home } = await setup(() => settings);
  const bitmap = Buffer.alloc(58);
  bitmap.write("BM");
  bitmap.writeUInt32LE(58, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(1, 18);
  bitmap.writeInt32LE(1, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(4, 34);
  const prepared = await (await createNodePhotonImages()).prepare(
    bitmap,
    "image/bmp",
    DEFAULT_IMAGE_LIMITS,
  );
  if (!prepared) throw new Error("Unable to create image fixture");
  const data = prepared.data;
  await writeFile(join(home, "image.png"), Buffer.from(data, "base64"));
  faux.setResponses([
    (transcript) => {
      expect(JSON.stringify(transcript)).not.toContain('"type":"image"');
      expect(JSON.stringify(transcript)).toContain(blockedImageNote);
      return fauxAssistantMessage(fauxToolCall("read", { path: "image.png" }), {
        stopReason: "toolUse",
      });
    },
    (transcript) => {
      expect(JSON.stringify(transcript)).not.toContain('"type":"image"');
      return fauxAssistantMessage("done");
    },
  ]);
  const submission = await service.submit(conversation.id, "", "blocked-1", [
    { type: "image", data, mimeType: "image/png" },
  ]);
  expect((await submission.wait(context)).status).toBe("done");
  const messages = (await service.history(conversation.id)).flatMap(
    (entry) => entry.model ?? [],
  );
  expect(JSON.stringify(messages)).not.toContain('"type":"image"');
  const result = messages.find((message) => message.role === "toolResult");
  expect(result?.isError).toBeFalsy();
  expect(JSON.stringify(result?.content)).toContain(blockedImageNote);
  settings = { ...settings, blockImages: false };
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "image.png" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("unblocked"),
  ]);
  expect(
    (
      await (
        await service.submit(conversation.id, "read again", "unblocked-1")
      ).wait(context)
    ).status,
  ).toBe("done");
  expect(JSON.stringify(await service.history(conversation.id))).toContain(
    '"type":"image"',
  );
}, 15_000);

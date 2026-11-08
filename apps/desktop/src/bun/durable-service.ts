import { existsSync } from "node:fs";
import { join, win32 } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ImageContent, Message, Models } from "@earendil-works/pi-ai";
import {
  type AgentChange,
  type Conversation,
  type ConversationId,
  type Cursor,
  createRegistry,
  defineExtension,
  type EntryId,
  type EntryRecord,
  GenerationTask,
  Harness,
  hook,
  type ModelRef,
  type SubmissionDraft,
  ToolTask,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import {
  createCodingTools,
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import type { Settings } from "../shared/settings";
import { desktopConfigDir } from "./desktop-config";
import { codingResources, expandInput } from "./resources";
import { currentSettings } from "./settings";

export const durableStorageDir = join(desktopConfigDir, "durable");

// Bun on Windows cannot reliably launch Git's bin/bash.exe wrapper; use the real executable.
export function resolveGitBash(
  env: NodeJS.ProcessEnv = process.env,
  git: string | null = Bun.which("git"),
  exists: (path: string) => boolean = existsSync,
) {
  const roots = [
    git && win32.resolve(win32.dirname(git), ".."),
    git && win32.resolve(win32.dirname(git), "..", ".."), // <root>\mingw64\bin\git.exe
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs", "Git"),
    env.ProgramFiles && win32.join(env.ProgramFiles, "Git"),
    env["ProgramFiles(x86)"] && win32.join(env["ProgramFiles(x86)"], "Git"),
  ];
  return roots
    .filter((root): root is string => !!root)
    .map((root) => win32.join(root, "usr", "bin", "bash.exe"))
    .find(exists);
}

export function resolvePowerShell(
  which: (name: string) => string | null = Bun.which,
) {
  const path = which("pwsh.exe") ?? which("powershell.exe");
  if (!path)
    throw new Error(
      "PowerShell is selected, but neither pwsh.exe nor powershell.exe was found on PATH.",
    );
  return path;
}

export function shellCommand(
  shell: Settings["shell"],
  path: string,
  command: string,
) {
  return shell === "powershell"
    ? [path, "-NoProfile", "-NonInteractive", "-Command", command]
    : [path, "-c", command];
}

/** The SDK only supports Bash's -c for shellPath. Explicit argv preserves its streaming, timeout and cancellation behavior. */
export class AgentExecutionEnv extends NodeExecutionEnv {
  constructor(
    cwd: string,
    private readonly settings: () => Settings = currentSettings,
  ) {
    super({ cwd });
  }
  override exec(
    command: Parameters<NodeExecutionEnv["exec"]>[0],
    options: Parameters<NodeExecutionEnv["exec"]>[1],
    context: Parameters<NodeExecutionEnv["exec"]>[2],
  ) {
    if (typeof command === "string") {
      const shell = this.settings().shell;
      if (shell === "powershell")
        command = shellCommand(shell, resolvePowerShell(), command);
      else if (process.platform === "win32") {
        const path = resolveGitBash();
        if (!path)
          throw new Error(
            "Git Bash is selected, but Git for Windows' usr/bin/bash.exe was not found. Install Git for Windows.",
          );
        command = shellCommand(shell, path, command);
      }
    }
    return super.exec(command, options, context);
  }
}

export const blockedImageNote =
  "[Image removed: images are blocked by settings.]";
export function stripImages<T extends { type: string }>(
  content: readonly T[],
): (T | { type: "text"; text: string })[] {
  return content.map((block) =>
    block.type === "image"
      ? { type: "text" as const, text: blockedImageNote }
      : block,
  );
}

export function imageBlocking(settings: () => Settings) {
  return defineExtension({
    name: "desktop-block-images",
    hooks: [
      hook(ToolTask, {
        afterTool: (_call, result) =>
          settings().blockImages && result.output
            ? { ...result, output: stripImages(result.output) }
            : undefined,
      }),
      hook(GenerationTask, {
        beforeRequest: ({ messages }) =>
          settings().blockImages
            ? {
                messages: messages.map(
                  (message): Message =>
                    (message.role === "user" ||
                      message.role === "toolResult") &&
                    Array.isArray(message.content)
                      ? { ...message, content: stripImages(message.content) }
                      : message,
                ),
              }
            : undefined,
      }),
    ],
  });
}

/** Application-owned runtime. No legacy session files or credentials are opened here. */
export class DurableService {
  private constructor(
    readonly harness: Harness,
    private readonly models: Models,
    private readonly images: ImageProcessor,
    private readonly resourceDir: string,
    private readonly settings: () => Settings,
  ) {}

  static async open(
    models: Models,
    directory = durableStorageDir,
    options: { resourceDir?: string; settings?: () => Settings } = {},
  ) {
    const registry = createRegistry();
    const images = await createNodePhotonImages();
    const resourceDir = options.resourceDir ?? desktopConfigDir;
    const settings = options.settings ?? currentSettings;
    registry.install(createCodingTools({ images }));
    registry.install(imageBlocking(settings));
    registry.install(codingResources(resourceDir, settings));
    const storage = await openNodeJsonlStorage(directory, context);
    try {
      const harness = await Harness.open(
        storage,
        {
          models,
          registry,
          env: ({ cwd }) =>
            cwd ? new AgentExecutionEnv(cwd, settings) : undefined,
        },
        context,
      );
      harness.resume();
      return new DurableService(harness, models, images, resourceDir, settings);
    } catch (error) {
      await storage.close(context);
      throw error;
    }
  }

  create(cwd: string, model?: ModelRef) {
    return this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd, ...(model ? { model } : {}) },
      },
      context,
    );
  }

  async conversation(id: string | ConversationId): Promise<Conversation> {
    if (typeof id === "string" && !/^[1-9]\d*$/.test(id))
      throw new Error("Invalid chat ID.");
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 1)
      throw new Error("Invalid chat ID.");
    const conversation = await this.harness.conversation(
      numericId as ConversationId,
      context,
    );
    if (!conversation) throw new Error("Chat not found.");
    return conversation;
  }

  async history(id: string | ConversationId) {
    const conversation = await this.conversation(id);
    const entries: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await conversation.entries(
        { order: "ascending" },
        200,
        cursor,
        context,
      );
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return entries;
  }

  async list(cwd: string) {
    const result: {
      id: string;
      cwd: string;
      title: string;
      modified: number;
    }[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.harness.commit(
        (tx) => tx.scanConversations({}, 200, cursor),
        context,
      );
      for (const record of page.items) {
        const conversation = await this.conversation(record.id);
        if ((await conversation.agent(context)).cwd !== cwd) continue;
        const entries = await this.history(record.id);
        if (entries.some((entry) => entry.kind === "pig.deleted")) continue;
        const messages = entries.flatMap((entry) => entry.model ?? []);
        const first = messages.find((message) => message.role === "user");
        const name = [...entries]
          .reverse()
          .find((entry) => entry.kind === "pig.name")?.data;
        const named =
          name && typeof name === "object" && !Array.isArray(name)
            ? name
            : undefined;
        result.push({
          id: String(record.id),
          cwd,
          title:
            typeof named?.name === "string"
              ? named.name
              : typeof name === "string"
                ? name
                : first
                  ? typeof first.content === "string"
                    ? first.content
                    : first.content
                        .filter((block) => block.type === "text")
                        .map((block) => block.text)
                        .join(" ")
                  : "New chat",
          modified: Math.max(
            ...messages.map((message) => message.timestamp),
            ...entries.map((entry) => {
              const data = entry.kind === "pig.name" ? entry.data : undefined;
              return data &&
                typeof data === "object" &&
                !Array.isArray(data) &&
                typeof data.timestamp === "number"
                ? data.timestamp
                : 0;
            }),
            0,
          ),
        });
      }
      cursor = page.next;
    } while (cursor);
    return result.sort((a, b) => b.modified - a.modified);
  }

  /** Resolves only after durable admission; a rejected admission propagates to RPC. */
  async submit(
    id: string | ConversationId,
    text: string,
    requestId: string,
    images?: ImageContent[],
  ) {
    if (!requestId || typeof requestId !== "string")
      throw new Error("Missing request ID.");
    if (!text.trim() && !images?.length) throw new Error("Message is empty.");
    if (this.settings().blockImages && images?.length) {
      text = [text, ...images.map(() => blockedImageNote)].join("\n\n");
      images = undefined;
    }
    const conversation = await this.conversation(id);
    const agent = await conversation.agent(context);
    text = await expandInput(
      text,
      agent.cwd ?? process.cwd(),
      this.resourceDir,
    );
    const model = agent.model
      ? this.models.getModel(agent.model.provider, agent.model.modelId)
      : undefined;
    const resize = model?.inputLimits?.images?.resize;
    const limits = {
      maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
      maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
      maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
    };
    const prepared: ImageContent[] = [];
    const hints: string[] = [];
    for (const image of images ?? []) {
      const result = await this.images.prepare(
        Buffer.from(image.data, "base64"),
        image.mimeType,
        limits,
      );
      if (!result) {
        hints.push(
          "[Image could not be decoded or resized to fit model limits.]",
        );
        continue;
      }
      prepared.push({
        type: "image",
        data: result.data,
        mimeType: result.mimeType,
      });
      if (result.resized)
        hints.push(
          `[Image resized from ${result.resized.from.width}x${result.resized.from.height} to ${result.resized.to.width}x${result.resized.to.height}.]`,
        );
    }
    if (hints.length) text = [text, ...hints].join("\n\n");
    const content = prepared.length
      ? [{ type: "text" as const, text }, ...prepared]
      : text;
    return this.admit(id, {
      type: "input",
      content,
      requestId,
      whenBusy: "followUp",
    });
  }

  async admit(id: string | ConversationId, draft: SubmissionDraft) {
    if (
      this.settings().blockImages &&
      draft.type === "input" &&
      Array.isArray(draft.content)
    )
      draft = { ...draft, content: stripImages(draft.content) };
    return (await this.conversation(id)).submit(draft, context);
  }

  async watch(id: string | ConversationId) {
    return (await this.conversation(id)).watch(context);
  }

  async abort(id: string | ConversationId) {
    await (await this.conversation(id)).abort(context);
  }

  async configure(id: string | ConversationId, change: AgentChange) {
    await (await this.conversation(id)).configure(change, context);
  }

  async fork(id: string | ConversationId, at: string | EntryId) {
    const numericId = Number(at);
    if (!Number.isSafeInteger(numericId) || numericId < 1)
      throw new Error("Invalid entry ID.");
    return (await this.conversation(id)).fork(
      numericId as EntryId,
      { ownership: { kind: "ownerless" } },
      context,
    );
  }

  async rename(id: string | ConversationId, name: string) {
    if (!name.trim()) throw new Error("Chat name is empty.");
    await this.admit(id, {
      type: "write",
      entry: {
        kind: "pig.name",
        data: { name: name.trim(), timestamp: Date.now() },
      },
    });
  }

  async remove(id: string | ConversationId) {
    await this.abort(id);
    // Durable has no conversation deletion API. A tombstone hides it, without touching ancestry.
    await this.admit(id, { type: "write", entry: { kind: "pig.deleted" } });
  }

  close() {
    return this.harness.close(context);
  }
}

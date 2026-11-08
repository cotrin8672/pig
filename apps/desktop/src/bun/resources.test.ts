import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getSystemMessageText,
} from "@earendil-works/pi-ai";
import { DurableService } from "./durable-service";
import {
  expandInput,
  loadContextFiles,
  loadSkills,
  loadTemplates,
  substituteArgs,
} from "./resources";

const directories: string[] = [];
const services: DurableService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pig-resources-"));
  directories.push(root);
  const global = join(root, "global");
  const cwd = join(root, "project", "child");
  await mkdir(cwd, { recursive: true });
  return { root, global, cwd };
}
async function file(path: string, text: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
function skill(name: string, body = "Skill body", hidden = false) {
  return `---\nname: ${name}\ndescription: Instructions for ${name}\ndisable-model-invocation: ${hidden}\n---\n${body}`;
}

test("context candidates and global/ancestor/cwd order, BOM, and re-read", async () => {
  const { root, global, cwd } = await fixture();
  await file(join(global, "CLAUDE.md"), "global");
  await file(join(root, "AGENTS.md"), "ancestor");
  await file(join(cwd, "CLAUDE.md"), "wrong claude");
  await file(join(cwd, "AGENTS.md"), "wrong agents");
  await file(join(cwd, "AGENTS.override.md"), "\uFEFFoverride");
  const files = await loadContextFiles(cwd, global);
  expect(files.slice(-3).map((file) => file.content)).toEqual([
    "global",
    "ancestor",
    "override",
  ]);
  await file(join(cwd, "AGENTS.override.md"), "changed");
  expect((await loadContextFiles(cwd, global)).at(-1)?.content).toBe("changed");
});

test("skills mirror old roots, first/global collision wins, recursion stops at SKILL, hidden and ignore", async () => {
  const { global, cwd } = await fixture();
  await file(
    join(global, "skills", "review", "SKILL.md"),
    skill("review", "Global review"),
  );
  await file(
    join(cwd, ".pi", "skills", "review", "SKILL.md"),
    skill("review", "Project review"),
  );
  await file(
    join(cwd, ".pi", "skills", "deep", "hidden", "SKILL.md"),
    skill("hidden", "Secret", true),
  );
  await file(
    join(cwd, ".pi", "skills", "deep", "hidden", "nested", "SKILL.md"),
    skill("not-loaded"),
  );
  await file(
    join(cwd, ".agents", "skills", "SKILL.md"),
    skill("not-old-default"),
  );
  await file(join(cwd, ".pi", "skills", ".ignore"), "ignored/\n");
  await file(
    join(cwd, ".pi", "skills", "ignored", "SKILL.md"),
    skill("ignored"),
  );
  expect((await loadSkills(cwd, global)).map((skill) => skill.name)).toEqual([
    "review",
    "hidden",
  ]);
  const expanded = await expandInput("/skill:review  do this ", cwd, global);
  expect(expanded).toContain("Global review\n</skill>\n\ndo this");
  expect(expanded).toContain(
    `References are relative to ${join(global, "skills", "review")}.`,
  );
  expect(expanded).not.toContain("description:");
  expect(await expandInput("/skill:hidden", cwd, global)).toContain("Secret");
  expect(await expandInput("/skill:missing", cwd, global)).toBe(
    "/skill:missing",
  );
});

test("prompt templates are nonrecursive, global first, strip YAML and support all argument forms", async () => {
  const { global, cwd } = await fixture();
  await file(
    join(global, "prompts", "review.md"),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: prompt-template syntax, not JavaScript interpolation.
    "---\ndescription: Review\n---\nGlobal $1 | $2 | $@ | ${@:2:1} | ${3:-fallback}",
  );
  await file(join(cwd, ".pi", "prompts", "review.md"), "Project");
  await file(join(cwd, ".pi", "prompts", "local.md"), "Local $ARGUMENTS");
  await file(join(cwd, ".pi", "prompts", "nested", "not-loaded.md"), "No");
  expect((await loadTemplates(cwd, global)).size).toBe(2);
  expect(await expandInput('/review "two words" tail', cwd, global)).toBe(
    "Global two words | tail | two words tail | tail | fallback",
  );
  expect(await expandInput("/local yes", cwd, global)).toBe("Local yes");
  expect(await expandInput("/unknown yes", cwd, global)).toBe("/unknown yes");
  expect(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: tests literal shell-style placeholders.
    substituteArgs("${1:-default} ${@:-empty} ${@:0:1} $2", `'' '$1'`),
  ).toBe("default  $1  $1");
});

async function runtime(
  cwd: string,
  global: string,
  inputLimits?: { images: { resize: { maxWidth: number; maxHeight: number } } },
) {
  const faux = fauxProvider({
    tokensPerSecond: Infinity,
    models: [{ id: "test-model", input: ["text", "image"], inputLimits }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const service = await DurableService.open(models, join(global, "durable"), {
    resourceDir: global,
  });
  services.push(service);
  const model = faux.getModel();
  const conversation = await service.create(cwd, {
    provider: model.provider,
    modelId: model.id,
  });
  const prompts: string[] = [];
  faux.setResponses([
    async (transcript) => {
      prompts.push(
        transcript.messages
          .filter((message) => message.role === "system")
          .map(getSystemMessageText)
          .join("\n"),
      );
      return fauxAssistantMessage("Done");
    },
  ]);
  return { service, conversation, prompts, faux };
}

test("request sections contain coding role, tool rules, AGENTS text, skills, cwd/date and refresh after cwd changes", async () => {
  const { root, global, cwd } = await fixture();
  await file(join(cwd, "AGENTS.md"), "Project policy UNIQUE");
  await file(join(global, "skills", "review", "SKILL.md"), skill("review"));
  await file(
    join(global, "skills", "secret", "SKILL.md"),
    skill("secret", "Private", true),
  );
  const { service, conversation, prompts, faux } = await runtime(cwd, global);
  await (await service.submit(conversation.id, "Hello", "sections-1")).wait(
    context,
  );
  const prompt = prompts[0] ?? "";
  for (const text of [
    "You are a coding assistant",
    "Use read to examine files",
    "Use write only",
    "Project policy UNIQUE",
    "<available_skills>",
    "<name>review</name>",
    cwd.replace(/\\/g, "/"),
    "Current date:",
  ])
    expect(prompt).toContain(text);
  expect(prompt).not.toContain("<name>secret</name>");
  expect(prompt).not.toContain("docs/extensions.md");
  const other = join(root, "other");
  await file(join(other, "AGENTS.md"), "Other policy");
  await service.configure(conversation.id, { cwd: other });
  faux.setResponses([fauxAssistantMessage("Again")]);
  await (await service.submit(conversation.id, "Again", "sections-2")).wait(
    context,
  );
  const systems = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "system");
  expect(systems.map(getSystemMessageText).join("\n")).toContain(
    "Other policy",
  );
}, 15_000);

test("SYSTEM and APPEND project files independently replace global, and deletion falls back", async () => {
  const { global, cwd } = await fixture();
  await file(join(global, "SYSTEM.md"), "Global persona");
  await file(join(global, "APPEND_SYSTEM.md"), "Global addendum");
  await file(join(cwd, ".pi", "SYSTEM.md"), "Project persona");
  await file(join(cwd, ".pi", "APPEND_SYSTEM.md"), "Project addendum");
  const { service, conversation, prompts, faux } = await runtime(cwd, global);
  await (await service.submit(conversation.id, "Hello", "custom-1")).wait(
    context,
  );
  expect(prompts[0]).toContain("Project persona");
  expect(prompts[0]).toContain("Project addendum");
  expect(prompts[0]).not.toContain("Global persona");
  expect(prompts[0]).not.toContain("Use read to examine files");
  await rm(join(cwd, ".pi", "SYSTEM.md"));
  faux.setResponses([fauxAssistantMessage("Again")]);
  await (await service.submit(conversation.id, "Again", "custom-2")).wait(
    context,
  );
  const systems = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "system");
  expect(systems.map(getSystemMessageText).join("\n")).toContain(
    "Global persona",
  );
}, 15_000);

// Uncompressed BMP fixture avoids depending on a second image encoder to test Photon WASM loading.
function bmp(width: number, height: number) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bytes = Buffer.alloc(54 + stride * height, 127);
  bytes.write("BM");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(0, 6);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(stride * height, 34);
  bytes.fill(0, 38, 54);
  return bytes;
}

test("Photon WASM loads under Bun and incoming images obey model dimensions", async () => {
  const { global, cwd } = await fixture();
  const { service, conversation } = await runtime(cwd, global, {
    images: { resize: { maxWidth: 100, maxHeight: 80 } },
  });
  await (
    await service.submit(conversation.id, "Photo", "image-1", [
      {
        type: "image",
        mimeType: "image/bmp",
        data: bmp(300, 240).toString("base64"),
      },
    ])
  ).wait(context);
  const user = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .find((message) => message.role === "user");
  const image =
    user && Array.isArray(user.content)
      ? user.content.find((block) => block.type === "image")
      : undefined;
  expect(image?.mimeType).toBe("image/png");
  const bytes = Buffer.from(image?.data ?? "", "base64");
  expect(bytes.readUInt32BE(16)).toBe(100);
  expect(bytes.readUInt32BE(20)).toBe(80);
}, 20_000);

test("list metadata uses first user, latest name, and rename time after reopen", async () => {
  const { global, cwd } = await fixture();
  const { service, conversation } = await runtime(cwd, global);
  await (
    await service.submit(conversation.id, "First question", "name-1")
  ).wait(context);
  const before = (await service.list(cwd))[0];
  if (!before) throw new Error("Missing conversation");
  expect(before.title).toBe("First question");
  await Bun.sleep(5);
  await service.rename(conversation.id, "Renamed");
  const after = (await service.list(cwd))[0];
  if (!after) throw new Error("Missing renamed conversation");
  expect(after.title).toBe("Renamed");
  expect(after.modified).toBeGreaterThan(before.modified);
  await service.close();
  services.splice(services.indexOf(service), 1);
  const models = createModels();
  const reopened = await DurableService.open(models, join(global, "durable"), {
    resourceDir: global,
  });
  services.push(reopened);
  expect((await reopened.list(cwd))[0]).toEqual(after);
}, 15_000);

test("submit expands templates and skills before durable admission", async () => {
  const { global, cwd } = await fixture();
  await file(join(cwd, ".pi", "prompts", "review.md"), "Review $1");
  await file(
    join(cwd, ".pi", "skills", "review", "SKILL.md"),
    skill("review", "Read carefully"),
  );
  const { service, conversation, faux } = await runtime(cwd, global);
  await (
    await service.submit(conversation.id, "/review change", "expand-1")
  ).wait(context);
  faux.setResponses([fauxAssistantMessage("Done")]);
  await (
    await service.submit(conversation.id, "/skill:review change", "expand-2")
  ).wait(context);
  const users = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "user");
  expect(users[0]?.content).toBe("Review change");
  expect(users[1]?.content).toContain("Read carefully\n</skill>\n\nchange");
}, 15_000);

test("read tool uses Photon to convert and resize oversized BMP files", async () => {
  const { global, cwd } = await fixture();
  await file(join(cwd, "large.bmp"), bmp(3000, 30));
  const { service, conversation, faux } = await runtime(cwd, global);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "large.bmp" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done"),
  ]);
  const receipt = await (
    await service.submit(conversation.id, "Read image", "read-image-1")
  ).wait(context);
  expect(receipt.status).toBe("done");
  const result = (await service.history(conversation.id))
    .flatMap((entry) => entry.model ?? [])
    .find((message) => message.role === "toolResult");
  expect(result?.isError).toBeFalsy();
  const image = result?.content.find((block) => block.type === "image");
  expect(image?.mimeType).toBe("image/png");
  expect(Buffer.from(image?.data ?? "", "base64").readUInt32BE(16)).toBe(2000);
}, 20_000);

test("nested linked worktree shadows the main checkout context", async () => {
  const { root, global } = await fixture();
  const main = join(root, "repo");
  const worktree = join(main, "trees", "feature");
  const gitDir = join(main, ".git", "worktrees", "feature");
  await file(join(main, "AGENTS.md"), "Main instructions");
  await file(join(worktree, "AGENTS.md"), "Feature instructions");
  await file(join(worktree, ".git"), `gitdir: ${gitDir}`);
  await file(join(gitDir, "commondir"), "../..");
  const files = await loadContextFiles(worktree, global);
  expect(files.some((file) => file.content === "Main instructions")).toBe(
    false,
  );
  expect(files.at(-1)?.content).toBe("Feature instructions");
});

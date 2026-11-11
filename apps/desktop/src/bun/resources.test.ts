import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getSystemMessageText,
} from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  desktopResourceOptions,
  expandInput,
  loadContextFiles,
  loadSkills,
  loadTemplates,
  substituteArgs,
} from "./resources";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "./sdk";

const directories: string[] = [],
  sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pig-resources-"));
  directories.push(root);
  const global = join(root, "global"),
    cwd = join(root, "project", "child");
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
  expect(
    (await loadContextFiles(cwd, global)).slice(-3).map((f) => f.content),
  ).toEqual(["global", "ancestor", "override"]);
  await file(join(cwd, "AGENTS.override.md"), "changed");
  expect((await loadContextFiles(cwd, global)).at(-1)?.content).toBe("changed");
});
test("skills retain global collision precedence, recursion, hidden and ignore", async () => {
  const { global, cwd } = await fixture();
  await file(
    join(global, "skills/review/SKILL.md"),
    skill("review", "Global review"),
  );
  await file(
    join(cwd, ".pi/skills/review/SKILL.md"),
    skill("review", "Project review"),
  );
  await file(
    join(cwd, ".pi/skills/deep/hidden/SKILL.md"),
    skill("hidden", "Secret", true),
  );
  await file(
    join(cwd, ".pi/skills/deep/hidden/nested/SKILL.md"),
    skill("not-loaded"),
  );
  await file(join(cwd, ".agents/skills/SKILL.md"), skill("not-old-default"));
  await file(join(cwd, ".pi/skills/.ignore"), "ignored/\n");
  await file(join(cwd, ".pi/skills/ignored/SKILL.md"), skill("ignored"));
  expect((await loadSkills(cwd, global)).map((s) => s.name)).toEqual([
    "review",
    "hidden",
  ]);
  expect(await expandInput("/skill:review do this", cwd, global)).toContain(
    "Global review\n</skill>\n\ndo this",
  );
  expect(await expandInput("/skill:hidden", cwd, global)).toContain("Secret");
  expect(await expandInput("/skill:missing", cwd, global)).toBe(
    "/skill:missing",
  );
});
test("prompt templates strip YAML and preserve argument forms and global-first collisions", async () => {
  const { global, cwd } = await fixture();
  await file(
    join(global, "prompts/review.md"),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: prompt-template syntax.
    "---\ndescription: Review\n---\nGlobal $1 | $2 | $@ | ${@:2:1} | ${3:-fallback}",
  );
  await file(join(cwd, ".pi/prompts/review.md"), "Project");
  await file(join(cwd, ".pi/prompts/local.md"), "Local $ARGUMENTS");
  await file(join(cwd, ".pi/prompts/nested/not-loaded.md"), "No");
  expect((await loadTemplates(cwd, global)).size).toBe(2);
  expect(await expandInput('/review "two words" tail', cwd, global)).toBe(
    "Global two words | tail | two words tail | tail | fallback",
  );
  expect(await expandInput("/local yes", cwd, global)).toBe("Local yes");
  expect(await expandInput("/unknown yes", cwd, global)).toBe("/unknown yes");
  expect(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal template syntax.
    substituteArgs("${1:-default} ${@:-empty} ${@:0:1} $2", `'' '$1'`),
  ).toBe("default  $1  $1");
});

async function runtime(
  cwd: string,
  global: string,
  trusted = true,
  inputLimits?: { images: { resize: { maxWidth: number; maxHeight: number } } },
) {
  const faux = fauxProvider({
    tokensPerSecond: Infinity,
    models: [{ id: "test-model", input: ["text", "image"], inputLimits }],
  });
  const models = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_id, fn) => fn(undefined),
      delete: async () => {},
    },
  });
  models.registerNativeProvider(faux.provider);
  await models.refresh({ allowNetwork: false });
  const services = await createAgentSessionServices({
    cwd,
    agentDir: global,
    modelRuntime: models,
    settingsManager: SettingsManager.inMemory(
      { cacheWarming: "off" },
      { projectTrusted: trusted },
    ),
    resourceLoaderOptions: await desktopResourceOptions(
      cwd,
      trusted,
      global,
      global,
    ),
    resourceLoaderReloadOptions: { resolveProjectTrust: async () => trusted },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    model: faux.getModel(),
  });
  sessions.push(session);
  const prompts: string[] = [];
  faux.setResponses([
    async (transcript) => {
      prompts.push(
        transcript.messages
          .filter((m) => m.role === "system")
          .map(getSystemMessageText)
          .join("\n"),
      );
      return fauxAssistantMessage("Done");
    },
  ]);
  return { session, services, prompts, faux };
}
test("SDK injects context/skills/cwd once, excluding hidden skills", async () => {
  const { global, cwd } = await fixture();
  await file(join(cwd, "AGENTS.md"), "POLICY_UNIQUE");
  await file(join(global, "skills/review/SKILL.md"), skill("review"));
  await file(
    join(global, "skills/secret/SKILL.md"),
    skill("secret", "Private", true),
  );
  const { session, prompts } = await runtime(cwd, global);
  await session.prompt("Hello");
  expect(prompts[0]?.split("POLICY_UNIQUE").length).toBe(2);
  expect(prompts[0]).toContain("<name>review</name>");
  expect(prompts[0]).not.toContain("<name>secret</name>");
  expect(prompts[0]).toContain(cwd);
});
test("SYSTEM/APPEND precedence, deletion fallback and safe mode", async () => {
  const { global, cwd } = await fixture();
  await file(join(global, "SYSTEM.md"), "Global persona");
  await file(join(global, "APPEND_SYSTEM.md"), "Global addendum");
  await file(join(cwd, ".pi/SYSTEM.md"), "Project persona");
  await file(join(cwd, ".pi/APPEND_SYSTEM.md"), "Project addendum");
  await file(join(cwd, "AGENTS.md"), "Untrusted policy");
  const first = await runtime(cwd, global);
  await first.session.prompt("Hello");
  expect(first.prompts[0]).toContain("Project persona");
  expect(first.prompts[0]).toContain("Project addendum");
  expect(first.prompts[0]).not.toContain("Global persona");
  await rm(join(cwd, ".pi/SYSTEM.md"));
  const second = await runtime(cwd, global);
  await second.session.prompt("Again");
  expect(second.prompts[0]).toContain("Global persona");
  const safe = await runtime(cwd, global, false);
  await safe.session.prompt("Safe");
  expect(safe.prompts[0]).not.toContain("Untrusted policy");
  expect(safe.prompts[0]).not.toContain("Project addendum");
  expect(safe.prompts[0]).toContain("Global addendum");
});
function bmp(width: number, height: number) {
  const stride = Math.ceil((width * 3) / 4) * 4,
    bytes = Buffer.alloc(54 + stride * height, 127);
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
test("SDK Photon normalizes initial BMP once to model dimensions", async () => {
  const { global, cwd } = await fixture();
  const { session } = await runtime(cwd, global, true, {
    images: { resize: { maxWidth: 100, maxHeight: 80 } },
  });
  await session.prompt("Photo", {
    images: [
      {
        type: "image",
        mimeType: "image/bmp",
        data: bmp(300, 240).toString("base64"),
      },
    ],
  });
  const user = session.messages.find((m) => m.role === "user");
  const image =
    user && Array.isArray(user.content)
      ? user.content.find((b) => b.type === "image")
      : undefined;
  expect(image?.mimeType).toBe("image/png");
  const bytes = Buffer.from(image?.data ?? "", "base64");
  expect(bytes.readUInt32BE(16)).toBe(100);
  expect(bytes.readUInt32BE(20)).toBe(80);
}, 20_000);
test("SDK expands templates and skills without a second app injection", async () => {
  const { global, cwd } = await fixture();
  await file(join(cwd, ".pi/prompts/review.md"), "Review $1");
  await file(join(global, "prompts/review.md"), "Global review $1");
  await file(
    join(global, "skills/review/SKILL.md"),
    skill("review", "Global carefully"),
  );
  await file(
    join(cwd, ".pi/skills/review/SKILL.md"),
    skill("review", "Read carefully"),
  );
  const { session, faux } = await runtime(cwd, global);
  await session.prompt("/review change");
  faux.setResponses([fauxAssistantMessage("Again")]);
  await session.prompt("/skill:review change");
  const users = session.messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
    );
  expect(users[0]).toBe("Global review change");
  expect(users[1]).toContain("Global carefully");
});
test("SDK read tool converts and resizes oversized BMP files", async () => {
  const { global, cwd } = await fixture();
  await file(join(cwd, "large.bmp"), bmp(3000, 30));
  const { session, faux } = await runtime(cwd, global);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "large.bmp" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done"),
  ]);
  await session.prompt("Read image");
  const result = session.messages.find((m) => m.role === "toolResult");
  expect(result?.isError).toBeFalsy();
  const image = result?.content.find((b) => b.type === "image");
  expect(image?.mimeType).toBe("image/png");
  expect(Buffer.from(image?.data ?? "", "base64").readUInt32BE(16)).toBe(2000);
}, 20_000);
test("nested linked worktree shadows the main checkout context", async () => {
  const { root, global } = await fixture();
  const main = join(root, "repo"),
    worktree = join(main, "trees/feature"),
    gitDir = join(main, ".git/worktrees/feature");
  await file(join(main, "AGENTS.md"), "Main instructions");
  await file(join(worktree, "AGENTS.md"), "Feature instructions");
  await file(join(worktree, ".git"), `gitdir: ${gitDir}`);
  await file(join(gitDir, "commondir"), "../..");
  const files = await loadContextFiles(worktree, global);
  expect(files.some((f) => f.content === "Main instructions")).toBe(false);
  expect(files.at(-1)?.content).toBe("Feature instructions");
});

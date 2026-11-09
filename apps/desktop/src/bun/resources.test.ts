import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  getSystemMessageText,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type Harness as NativeHarness,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createResourcesExtension,
  expandInput,
  frontmatter,
  inspectResourceSelection,
  loadResources,
  RESOURCE_LIMITS,
  type ResourceSelection,
  type ResourceSnapshot,
  substituteArgs,
} from "./resources";

const paths: string[] = [],
  harnesses: NativeHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close(ctx);
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const root = await mkdtemp(join(process.env.PI_SCRATCH_DIR, "resources-"));
  paths.push(root);
  return realpath(root);
}
async function file(path: string, text: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return path;
}
const empty: ResourceSelection = { instructions: [], skills: [], prompts: [] };
function skill(name: string, hidden = false) {
  return `---\nname: ${name}\ndescription: Instructions for ${name}\ndisable-model-invocation: ${hidden}\n---\nSkill body ${name}`;
}
async function loaded(
  selection: ResourceSelection,
  root: string,
): Promise<ResourceSnapshot> {
  const result = await loadResources(selection, {
    trustedProjectPaths: [root],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.snapshot;
}

test("empty selection reads nothing, even invalid trust roots; no AGENTS/.pi/.agents/code discovery", async () => {
  const root = await fixture();
  await file(join(root, "AGENTS.md"), "UNSELECTED_ANCESTOR");
  await file(
    join(root, ".pi/extensions/boom.ts"),
    "globalThis.resourceCodeExecuted = true; throw Error('never import');",
  );
  await file(join(root, ".pi/SYSTEM.md"), "UNSELECTED_LEGACY");
  await file(join(root, ".agents/skills/boom/SKILL.md"), "---\nmalformed: [");
  expect(
    await loadResources(empty, {
      trustedProjectPaths: [join(root, "missing")],
    }),
  ).toEqual({
    ok: true,
    diagnostics: [],
    snapshot: { instructions: [], skills: [], prompts: [] },
  });
  const selected = await file(join(root, "selected.md"), "\uFEFFSELECTED_ONLY");
  const snapshot = await loaded({ ...empty, instructions: [selected] }, root);
  expect(snapshot.instructions).toEqual([
    { path: selected, content: "SELECTED_ONLY" },
  ]);
  expect(
    (globalThis as Record<string, unknown>).resourceCodeExecuted,
  ).toBeUndefined();
});
test("trust is required before parsing or returning model instructions", async () => {
  const root = await fixture(),
    path = await file(
      join(root, "selected.md"),
      "---\ninvalid: [\n---\nDO_NOT_USE",
    );
  const result = await loadResources(
    { ...empty, instructions: [path] },
    { trustedProjectPaths: [] },
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((item) => item.code)).toEqual(["untrusted"]);
  expect("snapshot" in result).toBe(false);
});
test("explicit roots only: bounded skill recursion, hidden skills, prompt frontmatter and pure expansion", async () => {
  const root = await fixture();
  await file(join(root, "skills/review/SKILL.md"), skill("review"));
  await file(join(root, "skills/secret/SKILL.md"), skill("secret", true));
  await file(join(root, "skills/review/nested/SKILL.md"), skill("not-loaded"));
  const prompt = await file(
    join(root, "prompts/review.md"),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal prompt syntax.
    "---\ndescription: Review\n---\nReview $1 | $2 | $@ | ${@:2:1} | ${3:-fallback}",
  );
  await file(join(root, "prompts/nested/no.md"), "not selected");
  const snapshot = await loaded(
    {
      ...empty,
      skills: [join(root, "skills")],
      prompts: [join(root, "prompts")],
    },
    root,
  );
  expect(snapshot.skills.map((item) => item.name)).toEqual([
    "review",
    "secret",
  ]);
  expect(snapshot.prompts).toHaveLength(1);
  expect(expandInput('/review "two words" tail', snapshot)).toBe(
    "Review two words | tail | two words tail | tail | fallback",
  );
  expect(expandInput("/skill:secret argument", snapshot)).toContain(
    "Skill body secret\n</skill>\n\nargument",
  );
  await writeFile(prompt, "changed on disk");
  await rm(join(root, "skills"), { recursive: true });
  expect(expandInput("/skill:review", snapshot)).toContain("Skill body review");
  expect(expandInput("/review same", snapshot)).toStartWith("Review same");
  expect(expandInput("/unknown yes", snapshot)).toBe("/unknown yes");
  expect(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal prompt syntax.
    substituteArgs("${1:-default} ${@:-empty} ${@:0:1} $2", `'' '$1'`),
  ).toBe("default  $1  $1");
  expect(frontmatter("plain")).toEqual({ metadata: {}, body: "plain" });
});
test("missing, invalid, duplicate, YAML and UTF-8 failures expose diagnostics, not partial snapshots", async () => {
  const root = await fixture(),
    good = await file(join(root, "good.md"), "last good");
  let previous = await loaded({ ...empty, instructions: [good] }, root);
  const original = previous;
  const bad = await file(join(root, "bad.md"), "---\nbad: [\n---\nno");
  const scalar = await file(
    join(root, "scalar.md"),
    "---\n- sequence\n---\nno",
  );
  const unclosed = await file(join(root, "unclosed.md"), "---\na: b");
  const binary = await file(
    join(root, "binary.md"),
    new Uint8Array([255, 254, 255]),
  );
  for (const [selection, code] of [
    [{ ...empty, instructions: [join(root, "missing")] }, "missing"],
    [{ ...empty, instructions: [root] }, "invalid"],
    [{ ...empty, instructions: [good, good] }, "duplicate"],
    [{ ...empty, instructions: [good, bad] }, "parse"],
    [{ ...empty, instructions: [scalar] }, "parse"],
    [{ ...empty, prompts: [unclosed] }, "parse"],
    [{ ...empty, instructions: [binary] }, "parse"],
    [{ ...empty, instructions: ["relative.md"] }, "invalid"],
  ] as const) {
    const candidate = await loadResources(selection, {
      trustedProjectPaths: [root],
    });
    if (candidate.ok) previous = candidate.snapshot;
    expect(candidate.diagnostics.some((item) => item.code === code)).toBe(true);
    expect(previous).toBe(original);
  }
  await file(join(root, "a/SKILL.md"), skill("collision"));
  await file(join(root, "b/SKILL.md"), skill("collision"));
  expect(
    (
      await loadResources(
        { ...empty, skills: [join(root, "a"), join(root, "b")] },
        { trustedProjectPaths: [root] },
      )
    ).diagnostics.some((item) => item.code === "duplicate"),
  ).toBe(true);
});
test("junction escape and overlaps are rejected; file byte and selection bounds and cancellation", async () => {
  const root = await fixture();
  await file(join(root, "outside/SKILL.md"), skill("outside"));
  await mkdir(join(root, "selected"));
  // Windows junctions require no Developer Mode/elevation; file symlinks are not assumed available.
  await symlink(
    join(root, "outside"),
    join(root, "selected/escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    (
      await loadResources(
        { ...empty, skills: [join(root, "selected")] },
        { trustedProjectPaths: [root] },
      )
    ).diagnostics[0]?.code,
  ).toBe("escape");
  const huge = await file(
    join(root, "huge.md"),
    "x".repeat(RESOURCE_LIMITS.fileBytes + 1),
  );
  expect(
    (
      await loadResources(
        { ...empty, instructions: [huge] },
        { trustedProjectPaths: [root] },
      )
    ).diagnostics[0]?.code,
  ).toBe("limit");
  await expect(
    inspectResourceSelection({
      ...empty,
      instructions: Array(RESOURCE_LIMITS.selections + 1).fill(huge),
    }),
  ).rejects.toThrow("Too many");
  const signal = AbortSignal.abort(new Error("cancel resources"));
  await expect(
    loadResources(
      { ...empty, instructions: [huge] },
      { trustedProjectPaths: [root], signal },
    ),
  ).rejects.toThrow("cancel resources");
});
test("native sections assemble without a model, capture approved bytes and inject each section once", async () => {
  const root = await fixture(),
    path = await file(join(root, "chosen.md"), "POLICY_UNIQUE");
  await file(join(root, "skills/review/SKILL.md"), skill("review"));
  await file(join(root, "skills/secret/SKILL.md"), skill("secret", true));
  const snapshot = await loaded(
      { ...empty, instructions: [path], skills: [join(root, "skills")] },
      root,
    ),
    extension = createResourcesExtension(snapshot);
  const registry = createRegistry();
  registry.install(extension);
  const models = createModels(),
    faux = fauxProvider({ tokensPerSecond: Infinity });
  models.setProvider(faux.provider);
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      registry,
      models,
      settings: { extensions: [] },
      env: () => new NodeExecutionEnv({ cwd: root }),
    },
    ctx,
  );
  harnesses.push(harness);
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { extensions: [extension], tools: [], cwd: root },
    },
    ctx,
  );
  expect((await conversation.agent(ctx)).model).toBeUndefined();
  expect(
    (await conversation.agent(ctx)).sections.map((section) => section.key),
  ).toEqual(["project-instructions", "skills", "cwd"]);
  await writeFile(path, "changed");
  let system = "";
  faux.setResponses([
    async (transcript) => {
      system = transcript.messages
        .filter((message) => message.role === "system")
        .map(getSystemMessageText)
        .join("\n");
      return fauxAssistantMessage("done");
    },
  ]);
  await conversation.configure(
    {
      model: {
        provider: faux.getModel().provider,
        modelId: faux.getModel().id,
      },
    },
    ctx,
  );
  expect(
    (
      await (
        await conversation.submit({ type: "input", content: "hello" }, ctx)
      ).wait(ctx)
    ).status,
  ).toBe("done");
  expect(system.split("POLICY_UNIQUE")).toHaveLength(2);
  expect(system).toContain(root);
  expect(system).toContain("<name>review</name>");
  expect(system).not.toContain("<name>secret</name>");
});

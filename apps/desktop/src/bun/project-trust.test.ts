import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverProjectResources,
  isProjectTrusted,
  persistProjectTrust,
  resolveProjectTrust,
} from "./project-trust";
import { UIRequestBroker } from "./ui-request-broker";

const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
const address = { hostId: "fixture", sessionId: "opaque", epoch: 1 };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pig-sdk-trust-"));
  paths.push(root);
  const cwd = join(root, "project"),
    profile = join(root, "profile");
  await mkdir(join(cwd, ".pi/extensions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi/extensions/never-execute.ts"),
    "throw new Error('must never execute during discovery');",
  );
  await writeFile(join(cwd, ".pi/SYSTEM.md"), "project instructions");
  return { cwd, profile };
}
test("discovery does not evaluate project code; unavailable and safe decisions never grant", async () => {
  const { cwd, profile } = await fixture();
  const resources = await discoverProjectResources(cwd);
  expect(resources.some((r) => r.kind === "code")).toBe(true);
  const controller = new AbortController();
  const unavailable = new UIRequestBroker(() => {});
  await expect(
    resolveProjectTrust(cwd, address, unavailable, controller.signal, profile),
  ).rejects.toThrow("cancelled");
  const broker = new UIRequestBroker((event) => {
    if (event.type === "request")
      queueMicrotask(() =>
        broker.resolve({
          ...event.request,
          kind: "project-trust",
          value: "safe",
        }),
      );
  });
  broker.setAvailable(true);
  const safe = await resolveProjectTrust(
    cwd,
    address,
    broker,
    controller.signal,
    profile,
  );
  expect(safe.trusted).toBe(false);
  expect(safe.omitted).toHaveLength(resources.length);
});
test("trust once is session-scoped and fingerprinted; changed code or another session asks again", async () => {
  const { cwd, profile } = await fixture();
  let requests = 0;
  const broker = new UIRequestBroker((event) => {
    if (event.type === "request") {
      requests++;
      queueMicrotask(() =>
        broker.resolve({
          ...event.request,
          kind: "project-trust",
          value: "once",
        }),
      );
    }
  });
  broker.setAvailable(true);
  const controller = new AbortController();
  expect(
    (
      await resolveProjectTrust(
        cwd,
        address,
        broker,
        controller.signal,
        profile,
      )
    ).trusted,
  ).toBe(true);
  await resolveProjectTrust(cwd, address, broker, controller.signal, profile);
  expect(requests).toBe(1);
  await writeFile(join(cwd, ".pi/SYSTEM.md"), "changed instructions");
  await resolveProjectTrust(cwd, address, broker, controller.signal, profile);
  expect(requests).toBe(2);
  await resolveProjectTrust(
    cwd,
    { ...address, epoch: 2 },
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(3);
});
test("pending trust obeys cancellation; persisted trust is explicit and corrupt storage fails closed", async () => {
  const { cwd, profile } = await fixture(),
    controller = new AbortController();
  const broker = new UIRequestBroker(() => {});
  broker.setAvailable(true);
  const pending = resolveProjectTrust(
    cwd,
    address,
    broker,
    controller.signal,
    profile,
  );
  while (!broker.pending().length) await Bun.sleep(1);
  controller.abort(new Error("fixture cancellation"));
  await expect(pending).rejects.toThrow("fixture cancellation");
  expect(broker.pending()).toEqual([]);
  const approving = new UIRequestBroker((event) => {
    if (event.type === "request")
      queueMicrotask(() =>
        approving.resolve({
          ...event.request,
          kind: "project-trust",
          value: "persist",
        }),
      );
  });
  approving.setAvailable(true);
  expect(
    (
      await resolveProjectTrust(
        cwd,
        address,
        approving,
        new AbortController().signal,
        profile,
      )
    ).trusted,
  ).toBe(true);
  broker.setAvailable(false);
  expect(
    (
      await resolveProjectTrust(
        cwd,
        address,
        broker,
        new AbortController().signal,
        profile,
      )
    ).trusted,
  ).toBe(true);
  // Folder-scoped: editing project files keeps persisted trust.
  await writeFile(join(cwd, ".pi/SYSTEM.md"), "edited after trust");
  expect(await isProjectTrusted(cwd, profile)).toBe(true);
  expect(
    (
      await resolveProjectTrust(
        cwd,
        address,
        broker,
        new AbortController().signal,
        profile,
      )
    ).trusted,
  ).toBe(true);
  await writeFile(join(profile, "desktop-trust.json"), "null");
  await expect(
    resolveProjectTrust(
      cwd,
      address,
      broker,
      new AbortController().signal,
      profile,
    ),
  ).rejects.toThrow("cancelled");
});

test("F3: .agents-only project asks Trust once (persisted trust survives skill/theme edits) and stops .agents at Git root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-trust-agents-"));
  paths.push(root);
  const repo = join(root, "repo"),
    cwd = join(repo, "child"),
    profile = join(root, "profile");
  const skill = join(repo, ".agents/skills/fixture/SKILL.md");
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(repo, ".agents/skills/fixture"), { recursive: true });
  await writeFile(skill, "first skill");
  await mkdir(join(root, ".agents/skills/outside"), { recursive: true });
  await writeFile(
    join(root, ".agents/skills/outside/SKILL.md"),
    "outside git root",
  );
  const found = await discoverProjectResources(cwd);
  expect(
    found.some(
      (resource) => resource.path === skill && resource.kind === "skill",
    ),
  ).toBe(true);
  expect(found.some((resource) => resource.path.includes("outside"))).toBe(
    false,
  );
  let requests = 0;
  const broker = new UIRequestBroker((event) => {
    if (event.type === "request") {
      requests++;
      queueMicrotask(() =>
        broker.resolve({
          ...event.request,
          kind: "project-trust",
          value: "persist",
        }),
      );
    }
  });
  broker.setAvailable(true);
  await resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(1);
  await resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(1);
  await writeFile(skill, "changed skill");
  await resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(1);
  await mkdir(join(cwd, ".pi/themes"), { recursive: true });
  await writeFile(join(cwd, ".pi/themes/custom.json"), "{}");
  await resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(1);
  await writeFile(join(cwd, ".pi/themes/custom.json"), '{"changed":true}');
  await resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  expect(requests).toBe(1);
});

test("F4: explicit global context is not listed as omitted; safe mode excludes home ancestors", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-trust-safe-"));
  paths.push(root);
  const global = join(root, ".config/pig"),
    profile = join(global, "pi-agent"),
    cwd = join(global, "general");
  await mkdir(cwd, { recursive: true });
  await mkdir(profile, { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "HOME ANCESTOR OMITTED");
  await writeFile(join(global, "AGENTS.md"), "GLOBAL EXPLICIT LOADED");
  await writeFile(join(profile, "CLAUDE.md"), "PROFILE EXPLICIT LOADED");
  const found = await discoverProjectResources(cwd, [global, profile]);
  expect(
    found.some((resource) => resource.path === join(global, "AGENTS.md")),
  ).toBe(false);
  expect(
    found.some((resource) => resource.path === join(root, "AGENTS.md")),
  ).toBe(true);
  const { desktopResourceOptions } = await import("./resources");
  const options = await desktopResourceOptions(cwd, false, global, profile);
  const files =
    options.agentsFilesOverride?.({ agentsFiles: [] }).agentsFiles ?? [];
  expect(files.map((file) => file.content)).toEqual([
    "GLOBAL EXPLICIT LOADED",
    "PROFILE EXPLICIT LOADED",
  ]);
  expect(
    files.some((file) => found.some((omitted) => omitted.path === file.path)),
  ).toBe(false);
});

test("untrusted folders wait for in-app approval; cancelling does not persist trust", async () => {
  const { cwd, profile } = await fixture();
  const broker = new UIRequestBroker(() => {});
  broker.setAvailable(true);
  const pending = resolveProjectTrust(
    cwd,
    address,
    broker,
    new AbortController().signal,
    profile,
  );
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  while (!broker.pending().length) await Bun.sleep(1);
  const request = broker.pending()[0];
  expect(request).toMatchObject({
    ...address,
    kind: "project-trust",
    cwd,
  });
  expect(settled).toBe(false);
  expect(await isProjectTrusted(cwd, profile)).toBe(false);
  broker.resolve({ ...request, kind: "cancel" });
  await expect(pending).rejects.toThrow("cancelled");
  expect(await isProjectTrusted(cwd, profile)).toBe(false);
  expect(broker.pending()).toEqual([]);
});

test("previously persisted folder trust skips the chat-open prompt", async () => {
  const { cwd, profile } = await fixture();
  expect(await isProjectTrusted(cwd, profile)).toBe(false);
  await persistProjectTrust(cwd, profile);
  const unavailable = new UIRequestBroker(() => {});
  const result = await resolveProjectTrust(
    cwd,
    address,
    unavailable,
    new AbortController().signal,
    profile,
  );
  expect(result.trusted).toBe(true);
});

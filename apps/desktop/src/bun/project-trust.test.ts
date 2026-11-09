import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isProjectTrusted,
  persistProjectTrust,
  resolveProjectTrust,
  selectedProjectResources,
} from "./project-trust";
import { loadResources, type ResourceSelection } from "./resources";
import { UIRequestBroker } from "./ui-request-broker";

const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
const address = { hostId: "fixture", sessionId: "opaque", epoch: 1 };
async function fixture() {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required");
  const root = await realpath(
    await mkdtemp(join(process.env.PI_SCRATCH_DIR, "trust-")),
  );
  paths.push(root);
  const cwd = join(root, "project"),
    directory = join(root, "trust-store"),
    path = join(cwd, "selected.md");
  await mkdir(join(cwd, ".pi/extensions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi/extensions/boom.ts"),
    "throw Error('must not execute');",
  );
  await writeFile(join(cwd, "AGENTS.md"), "not selected");
  await writeFile(join(root, "AGENTS.md"), "ancestor not selected");
  await writeFile(path, "selected instruction");
  const selection: ResourceSelection = {
    instructions: [path],
    skills: [],
    prompts: [],
  };
  return { root, cwd, directory, selection, path };
}
function approving(
  value: "once" | "persist" | "safe",
  onRequest: () => void = () => {},
) {
  const broker = new UIRequestBroker((event) => {
    if (event.type === "request") {
      onRequest();
      queueMicrotask(() =>
        broker.resolve({ ...event.request, kind: "project-trust", value }),
      );
    }
  });
  broker.setAvailable(true);
  return broker;
}
test("only actual selections are disclosed; unavailable/safe/cancel never grant model use", async () => {
  const f = await fixture(),
    signal = new AbortController().signal;
  expect(await selectedProjectResources(f.cwd, f.selection)).toEqual([
    { path: f.path, kind: "instructions" },
  ]);
  const unavailable = new UIRequestBroker(() => {});
  await expect(
    resolveProjectTrust(f.cwd, f.selection, address, unavailable, signal, f),
  ).rejects.toThrow("cancelled");
  const safe = await resolveProjectTrust(
    f.cwd,
    f.selection,
    address,
    approving("safe"),
    signal,
    f,
  );
  expect(safe.trusted).toBe(false);
  expect(safe.trustedProjectPaths).toEqual([]);
  expect(safe.omitted).toHaveLength(1);
  const resources = await loadResources(f.selection, safe);
  expect(resources.ok).toBe(false);
  expect(resources.diagnostics[0]?.code).toBe("untrusted");
  expect(
    await resolveProjectTrust(
      "nonexistent-project",
      { instructions: [], skills: [], prompts: [] },
      address,
      unavailable,
      signal,
      { directory: "nonexistent-store" },
    ),
  ).toEqual({ trusted: true, trustedProjectPaths: [], omitted: [] });
});
test("one-time trust is content- and selection-bound in its session, not global or executable", async () => {
  const f = await fixture(),
    scope = new AbortController().signal;
  let requests = 0;
  const broker = approving("once", () => requests++);
  const trust = () =>
    resolveProjectTrust(
      f.cwd,
      f.selection,
      address,
      broker,
      new AbortController().signal,
      { directory: f.directory, approvalScope: scope },
    );
  const first = await trust();
  expect(first.trusted).toBe(true);
  expect(first.trustedProjectPaths).toEqual([f.path]);
  expect((await loadResources(f.selection, first)).ok).toBe(true);
  await trust();
  expect(requests).toBe(1);
  await writeFile(
    join(f.cwd, "AGENTS.md"),
    "unselected changes do not invalidate",
  );
  await trust();
  expect(requests).toBe(1);
  await writeFile(f.path, "changed selected bytes");
  const changedAfterApproval = await loadResources(f.selection, first);
  expect(changedAfterApproval.ok).toBe(false);
  expect(changedAfterApproval.diagnostics[0]?.code).toBe("untrusted");
  await trust();
  expect(requests).toBe(2);
  await resolveProjectTrust(
    f.cwd,
    f.selection,
    address,
    broker,
    new AbortController().signal,
    { directory: f.directory },
  );
  expect(requests).toBe(3);
  const second = join(f.cwd, "second.md");
  await writeFile(second, "new resource");
  await resolveProjectTrust(
    f.cwd,
    { ...f.selection, instructions: [f.path, second] },
    address,
    broker,
    scope,
    { directory: f.directory, approvalScope: scope },
  );
  expect(requests).toBe(4);
});
test("folder trust persists, explicit project-add grants work, corrupt stores fail closed", async () => {
  const f = await fixture(),
    broker = new UIRequestBroker(() => {}),
    signal = new AbortController().signal;
  expect(await isProjectTrusted(f.cwd, f.directory)).toBe(false);
  await persistProjectTrust(f.cwd, f.directory);
  expect(await isProjectTrusted(f.cwd, f.directory)).toBe(true);
  expect(
    (await resolveProjectTrust(f.cwd, f.selection, address, broker, signal, f))
      .trusted,
  ).toBe(true);
  await writeFile(f.path, "edited after folder grant");
  expect(
    (await resolveProjectTrust(f.cwd, f.selection, address, broker, signal, f))
      .trusted,
  ).toBe(true);
  await writeFile(join(f.directory, "desktop-trust.json"), "null");
  await expect(
    resolveProjectTrust(f.cwd, f.selection, address, broker, signal, f),
  ).rejects.toThrow("cancelled");
  await resolveProjectTrust(
    f.cwd,
    f.selection,
    address,
    approving("persist"),
    signal,
    f,
  );
  expect(
    (
      await resolveProjectTrust(
        f.cwd,
        f.selection,
        address,
        broker,
        new AbortController().signal,
        f,
      )
    ).trusted,
  ).toBe(true);
  await writeFile(join(f.directory, "desktop-trust.json"), "{broken");
  await expect(
    resolveProjectTrust(
      f.cwd,
      f.selection,
      address,
      broker,
      new AbortController().signal,
      f,
    ),
  ).rejects.toThrow("cancelled");
});
test("pending cancellation clears UI request and never persists", async () => {
  const f = await fixture(),
    controller = new AbortController(),
    broker = new UIRequestBroker(() => {});
  broker.setAvailable(true);
  const pending = resolveProjectTrust(
    f.cwd,
    f.selection,
    address,
    broker,
    controller.signal,
    f,
  );
  const deadline = Date.now() + 1000;
  while (!broker.pending().length && Date.now() < deadline) await Bun.sleep(1);
  expect(broker.pending()).toHaveLength(1);
  controller.abort(new Error("cancel fixture"));
  await expect(pending).rejects.toThrow("cancel fixture");
  expect(broker.pending()).toEqual([]);
  expect(await isProjectTrusted(f.cwd, f.directory)).toBe(false);
});
test("bytes changed while the modal is open cannot inherit an earlier fingerprint approval", async () => {
  const f = await fixture();
  const broker = new UIRequestBroker((event) => {
    if (event.type === "request")
      void writeFile(f.path, "different bytes").then(() =>
        broker.resolve({
          ...event.request,
          kind: "project-trust",
          value: "persist",
        }),
      );
  });
  broker.setAvailable(true);
  await expect(
    resolveProjectTrust(
      f.cwd,
      f.selection,
      address,
      broker,
      new AbortController().signal,
      f,
    ),
  ).rejects.toThrow("changed during trust");
  expect(await isProjectTrusted(f.cwd, f.directory)).toBe(false);
});
test("outside-folder, missing and duplicate project selections fail diagnostically before a trust request", async () => {
  const f = await fixture(),
    outside = join(f.root, "external.md");
  await writeFile(outside, "explicit elsewhere");
  await expect(
    selectedProjectResources(f.cwd, {
      ...f.selection,
      instructions: [outside],
    }),
  ).rejects.toThrow("outside the project");
  await expect(
    selectedProjectResources(f.cwd, {
      ...f.selection,
      instructions: [join(f.cwd, "missing")],
    }),
  ).rejects.toThrow("ENOENT");
  await expect(
    selectedProjectResources(f.cwd, {
      ...f.selection,
      instructions: [f.path, f.path],
    }),
  ).rejects.toThrow("more than once");
});

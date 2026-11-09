import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UIRequest } from "../shared/extension-ui";
import type { SessionAddress } from "../shared/runtime-contract";
import { desktopConfigDir } from "./desktop-config";
import {
  contentBoundResourcePaths,
  inspectResourceSelection,
  RESOURCE_LIMITS,
  type ResourceSelection,
  ResourceSelectionError,
  readSelectedResource,
  resourcePathWithin,
} from "./resources";
import type { UIRequestBroker } from "./ui-request-broker";

type Resource = Extract<
  UIRequest,
  { kind: "project-trust" }
>["resources"][number];
const once = new WeakMap<AbortSignal, Map<string, string>>();

/** The host passes ONLY the selected project portion, not implicit or user-global roots. */
export async function selectedProjectResources(
  cwd: string,
  selection: ResourceSelection,
  signal?: AbortSignal,
): Promise<Resource[]> {
  const selected = await inspectResourceSelection(selection, { signal });
  if (!selected.length) return [];
  const canonical = await realpath(cwd);
  const outside = selected.filter(
    (file) => !resourcePathWithin(canonical, file.path),
  );
  if (outside.length)
    throw new ResourceSelectionError(
      outside.map((file) => ({
        path: file.path,
        code: "escape",
        message:
          "Selected project resource is outside the project; authorize it separately",
      })),
    );
  return selected
    .map((file) => ({ path: file.path, kind: file.kind }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
async function fingerprint(
  resources: readonly Resource[],
  signal: AbortSignal,
) {
  const hash = createHash("sha256");
  const files: { path: string; sha256: string }[] = [];
  let total = 0;
  for (const resource of resources) {
    const bytes = await readSelectedResource(resource.path, signal);
    total += bytes.length;
    if (total > RESOURCE_LIMITS.totalBytes)
      throw new ResourceSelectionError([
        {
          path: resource.path,
          code: "limit",
          message: "Project resources exceed total byte limit",
        },
      ]);
    files.push({
      path: resource.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    hash.update(JSON.stringify([resource.kind, resource.path, bytes.length]));
    hash.update(bytes);
  }
  signal.throwIfAborted();
  return { hash: hash.digest("hex"), files };
}
export type ProjectTrustResult = {
  trusted: boolean;
  /** Exact approved files, not a grant for future additions under a directory. */
  trustedProjectPaths: readonly string[];
  omitted: readonly Resource[];
};
export async function resolveProjectTrust(
  cwd: string,
  selection: ResourceSelection,
  address: SessionAddress,
  broker: UIRequestBroker,
  signal: AbortSignal,
  options: { directory: string; approvalScope?: AbortSignal },
): Promise<ProjectTrustResult> {
  const resources = await selectedProjectResources(cwd, selection, signal);
  signal.throwIfAborted();
  const approved = (
    paths: readonly string[] = resources.map((file) => file.path),
  ): ProjectTrustResult => ({
    trusted: true,
    trustedProjectPaths: paths,
    omitted: [],
  });
  if (!resources.length) return approved();
  const canonical = await realpath(cwd);
  if ((await readTrust(options.directory))[canonical] !== undefined)
    return approved();
  const initial = await fingerprint(resources, signal),
    approvalScope = options.approvalScope ?? signal;
  if (once.get(approvalScope)?.get(canonical) === initial.hash)
    return approved(contentBoundResourcePaths(initial.files));
  const reply = await broker.request(
    {
      ...address,
      uiId: crypto.randomUUID(),
      title: "Trust selected project resources?",
      kind: "project-trust",
      cwd,
      fingerprint: initial.hash,
      resources,
    },
    { signal },
  );
  signal.throwIfAborted();
  if (
    reply.kind !== "project-trust" ||
    !["once", "persist", "safe"].includes(reply.value)
  )
    throw new Error("Project opening cancelled");
  if (reply.value === "safe")
    return { trusted: false, trustedProjectPaths: [], omitted: resources };
  const current = await selectedProjectResources(cwd, selection, signal);
  if ((await fingerprint(current, signal)).hash !== initial.hash)
    throw new ResourceSelectionError([
      {
        path: cwd,
        code: "invalid",
        message: "Selected resources changed during trust approval; retry",
      },
    ]);
  if (reply.value === "persist")
    await persistProjectTrust(cwd, options.directory);
  let trustedOnce = once.get(approvalScope);
  if (!trustedOnce) {
    trustedOnce = new Map();
    once.set(approvalScope, trustedOnce);
  }
  trustedOnce.set(canonical, initial.hash);
  return approved(
    reply.value === "persist"
      ? undefined
      : contentBoundResourcePaths(initial.files),
  );
}
async function readTrust(directory: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(join(directory, "desktop-trust.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  )
    return value as Record<string, string>;
  return {};
}
/** Explicit persisted folder grant; no legacy agent profile lookup. */
export async function isProjectTrusted(
  cwd: string,
  directory = desktopConfigDir,
) {
  return (await readTrust(directory))[await realpath(cwd)] !== undefined;
}
export async function persistProjectTrust(
  cwd: string,
  directory = desktopConfigDir,
) {
  const saved = await readTrust(directory);
  saved[await realpath(cwd)] = "trusted";
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "desktop-trust.json"),
    JSON.stringify(saved),
    "utf8",
  );
}

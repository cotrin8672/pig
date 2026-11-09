import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";

/** Paths are explicit host selections, never discovery hints for legacy loaders. */
export type ResourceSelection = {
  readonly instructions: readonly string[];
  readonly skills: readonly string[];
  readonly prompts: readonly string[];
};
export type ResourceKind = "instructions" | "skill" | "prompt";
export type ResourceDiagnostic = {
  readonly path: string;
  readonly code:
    | "invalid"
    | "missing"
    | "io"
    | "duplicate"
    | "escape"
    | "limit"
    | "parse"
    | "untrusted";
  readonly message: string;
};
export type SelectedResource = {
  readonly path: string;
  readonly kind: ResourceKind;
};
export type ResourceSnapshot = {
  readonly instructions: readonly {
    readonly path: string;
    readonly content: string;
  }[];
  readonly skills: readonly {
    readonly name: string;
    readonly description: string;
    readonly path: string;
    readonly hidden: boolean;
    readonly content: string;
  }[];
  readonly prompts: readonly {
    readonly name: string;
    readonly description: string;
    readonly path: string;
    readonly content: string;
  }[];
};
export type ResourceLoadResult =
  | {
      readonly ok: true;
      readonly snapshot: ResourceSnapshot;
      readonly diagnostics: readonly [];
    }
  | { readonly ok: false; readonly diagnostics: readonly ResourceDiagnostic[] };

export const RESOURCE_LIMITS = Object.freeze({
  selections: 128,
  files: 512,
  entries: 2048,
  depth: 8,
  fileBytes: 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
});

class ResourceFailure extends Error {
  constructor(readonly diagnostic: ResourceDiagnostic) {
    super(diagnostic.message);
  }
}
function fail(
  path: string,
  code: ResourceDiagnostic["code"],
  message: string,
): never {
  throw new ResourceFailure({ path, code, message });
}
function diagnostic(path: string, error: unknown): ResourceDiagnostic {
  if (error instanceof ResourceFailure) return error.diagnostic;
  const code = (error as NodeJS.ErrnoException)?.code;
  return {
    path,
    code: code === "ENOENT" ? "missing" : "io",
    message: error instanceof Error ? error.message : String(error),
  };
}
export class ResourceSelectionError extends Error {
  constructor(readonly diagnostics: readonly ResourceDiagnostic[]) {
    super(
      diagnostics.map((item) => `${item.path}: ${item.message}`).join("\n"),
    );
  }
}
function pathKey(path: string) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
export function resourcePathWithin(root: string, path: string) {
  const rel = relative(pathKey(root), pathKey(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

const approvedBytes = new WeakMap<
  readonly string[],
  ReadonlyMap<string, string>
>();
/** Host trust capability. Pass the returned array unchanged to loadResources; copying it is a new unbound host grant. */
export function contentBoundResourcePaths(
  files: readonly { path: string; sha256: string }[],
): readonly string[] {
  const paths = Object.freeze(files.map((file) => file.path));
  approvedBytes.set(
    paths,
    new Map(files.map((file) => [pathKey(file.path), file.sha256])),
  );
  return paths;
}

/** Bounded names-only expansion of selected roots; does not read instructions or import code. */
export async function inspectResourceSelection(
  selection: ResourceSelection,
  options: { signal?: AbortSignal } = {},
): Promise<readonly SelectedResource[]> {
  options.signal?.throwIfAborted();
  const diagnostics: ResourceDiagnostic[] = [],
    files: SelectedResource[] = [];
  const roots = new Set<string>(),
    seen = new Set<string>();
  let entries = 0;
  const selections = [
    ...selection.instructions.map((path) => ({
      path,
      kind: "instructions" as const,
    })),
    ...selection.skills.map((path) => ({ path, kind: "skill" as const })),
    ...selection.prompts.map((path) => ({ path, kind: "prompt" as const })),
  ];
  if (selections.length > RESOURCE_LIMITS.selections)
    throw new ResourceSelectionError([
      { path: "", code: "limit", message: "Too many selected resources" },
    ]);
  async function visit(
    path: string,
    root: string,
    kind: ResourceKind,
    depth: number,
  ) {
    options.signal?.throwIfAborted();
    if (++entries > RESOURCE_LIMITS.entries || depth > RESOURCE_LIMITS.depth)
      fail(path, "limit", "Resource traversal limit exceeded");
    const canonical = await realpath(path);
    if (!resourcePathWithin(root, canonical))
      fail(path, "escape", "Resource symlink escapes its selected root");
    const info = await stat(canonical);
    if (info.isFile()) {
      if (seen.has(pathKey(canonical)))
        fail(path, "duplicate", "Resource selected more than once");
      if (files.length >= RESOURCE_LIMITS.files)
        fail(path, "limit", "Too many resource files");
      if (info.size > RESOURCE_LIMITS.fileBytes)
        fail(path, "limit", "Resource file exceeds byte limit");
      if (kind !== "instructions" && !canonical.toLowerCase().endsWith(".md"))
        fail(path, "invalid", "Expected a Markdown resource");
      seen.add(pathKey(canonical));
      files.push(Object.freeze({ path: canonical, kind }));
      return;
    }
    if (!info.isDirectory() || kind === "instructions")
      fail(path, "invalid", "Expected a regular resource file");
    if (seen.has(pathKey(canonical)))
      fail(
        path,
        "duplicate",
        "Resource root overlaps or contains a link cycle",
      );
    seen.add(pathKey(canonical));
    const children = (await readdir(canonical, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    entries += children.length;
    if (entries > RESOURCE_LIMITS.entries)
      fail(path, "limit", "Resource traversal limit exceeded");
    const declared =
      kind === "skill" && children.find((entry) => entry.name === "SKILL.md");
    if (declared) {
      await visit(join(canonical, declared.name), root, kind, depth + 1);
      return;
    }
    const before = files.length;
    for (const child of children) {
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      const childPath = join(canonical, child.name);
      if (kind === "prompt") {
        if (child.name.toLowerCase().endsWith(".md"))
          await visit(childPath, root, kind, depth + 1);
      } else if (child.isDirectory() || child.isSymbolicLink()) {
        await visit(childPath, root, kind, depth + 1);
      }
    }
    if (depth === 0 && files.length === before)
      fail(
        path,
        "invalid",
        `Selected root contains no ${kind} Markdown resources`,
      );
  }
  for (const item of selections) {
    options.signal?.throwIfAborted();
    try {
      if (!item.path.trim() || !isAbsolute(item.path))
        fail(
          item.path,
          "invalid",
          "Resource selections must be absolute paths",
        );
      const path = resolve(item.path),
        info = await lstat(path);
      if (info.isSymbolicLink())
        fail(
          path,
          "escape",
          "Select the resource's real path, not a symlink root",
        );
      const canonical = await realpath(path);
      if (roots.has(pathKey(canonical)))
        fail(path, "duplicate", "Resource root selected more than once");
      roots.add(pathKey(canonical));
      await visit(
        canonical,
        info.isDirectory() ? canonical : dirname(canonical),
        item.kind,
        0,
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      diagnostics.push(diagnostic(item.path, error));
    }
  }
  if (diagnostics.length)
    throw new ResourceSelectionError(Object.freeze(diagnostics));
  return Object.freeze(files);
}

/** Bounded, race-checked regular-file read. Trust uses these bytes only for a fingerprint. */
export async function readSelectedResource(
  path: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  if (
    pathKey(await realpath(path)) !== pathKey(path) ||
    (await lstat(path)).isSymbolicLink()
  )
    fail(path, "escape", "Resource changed to a symlink");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile())
      fail(path, "invalid", "Expected a regular resource file");
    if (before.size > RESOURCE_LIMITS.fileBytes)
      fail(path, "limit", "Resource file exceeds byte limit");
    const bytes = Buffer.alloc(RESOURCE_LIMITS.fileBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      signal?.throwIfAborted();
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat(),
      current = await stat(path);
    if (length > RESOURCE_LIMITS.fileBytes)
      fail(path, "limit", "Resource file exceeds byte limit");
    if (
      before.ino !== current.ino ||
      before.dev !== current.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      pathKey(await realpath(path)) !== pathKey(path)
    )
      fail(path, "invalid", "Resource changed while reading; retry selection");
    signal?.throwIfAborted();
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export function frontmatter(text: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (/^---(?:\r?\n|$)/.test(text))
      throw new Error("Unterminated YAML frontmatter");
    return { metadata: {}, body: text };
  }
  const parsed: unknown = Bun.YAML.parse(match[1] ?? "");
  if (
    parsed !== null &&
    parsed !== undefined &&
    (typeof parsed !== "object" || Array.isArray(parsed))
  )
    throw new Error("Frontmatter must be a YAML mapping");
  return {
    metadata: (parsed ?? {}) as Record<string, unknown>,
    body: text.slice(match[0].length),
  };
}

/** Invalid candidates never expose a partial snapshot; the host retains its last good one. */
export async function loadResources(
  selection: ResourceSelection,
  options: { trustedProjectPaths: readonly string[]; signal?: AbortSignal },
): Promise<ResourceLoadResult> {
  let selected: readonly SelectedResource[];
  try {
    selected = await inspectResourceSelection(selection, options);
  } catch (error) {
    options.signal?.throwIfAborted();
    return {
      ok: false,
      diagnostics:
        error instanceof ResourceSelectionError
          ? error.diagnostics
          : [diagnostic("", error)],
    };
  }
  if (!selected.length)
    return {
      ok: true,
      diagnostics: [],
      snapshot: Object.freeze({
        instructions: Object.freeze([]),
        skills: Object.freeze([]),
        prompts: Object.freeze([]),
      }),
    };
  const diagnostics: ResourceDiagnostic[] = [],
    trusted: string[] = [];
  for (const path of options.trustedProjectPaths) {
    try {
      if (!isAbsolute(path))
        fail(path, "invalid", "Trusted paths must be absolute");
      trusted.push(await realpath(path));
    } catch (error) {
      options.signal?.throwIfAborted();
      diagnostics.push(diagnostic(path, error));
    }
  }
  // Authorization is checked for the entire candidate before any body is parsed for model use.
  for (const file of selected)
    if (!trusted.some((root) => resourcePathWithin(root, file.path)))
      diagnostics.push({
        path: file.path,
        code: "untrusted",
        message: "Selected resource requires explicit trust before model use",
      });
  if (diagnostics.length) return { ok: false, diagnostics };
  const instructions: ResourceSnapshot["instructions"][number][] = [],
    skills: ResourceSnapshot["skills"][number][] = [],
    prompts: ResourceSnapshot["prompts"][number][] = [];
  const names = new Set<string>();
  let total = 0;
  for (const file of selected) {
    options.signal?.throwIfAborted();
    try {
      const bytes = await readSelectedResource(file.path, options.signal);
      total += bytes.length;
      if (total > RESOURCE_LIMITS.totalBytes)
        fail(file.path, "limit", "Selected resources exceed total byte limit");
      const approved = approvedBytes.get(options.trustedProjectPaths);
      if (
        approved &&
        approved.get(pathKey(file.path)) !==
          createHash("sha256").update(bytes).digest("hex")
      )
        fail(
          file.path,
          "untrusted",
          "Resource bytes changed after one-time trust; retry approval",
        );
      let parsed: ReturnType<typeof frontmatter>;
      try {
        parsed = frontmatter(
          new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, ""),
        );
      } catch (error) {
        fail(
          file.path,
          "parse",
          error instanceof Error ? error.message : String(error),
        );
      }
      const { metadata, body } = parsed;
      if (file.kind === "instructions") {
        instructions.push(Object.freeze({ path: file.path, content: body }));
        continue;
      }
      const name =
        metadata.name ??
        (file.kind === "skill"
          ? basename(dirname(file.path))
          : basename(file.path, ".md"));
      if (
        typeof name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)
      )
        fail(
          file.path,
          "invalid",
          "Resource name must be a bounded command identifier",
        );
      const key = `${file.kind}:${name}`;
      if (names.has(key))
        fail(file.path, "duplicate", `Duplicate ${file.kind} name: ${name}`);
      names.add(key);
      const description = metadata.description ?? "";
      if (
        typeof description !== "string" ||
        (file.kind === "skill" && !description.trim())
      )
        fail(
          file.path,
          "invalid",
          "Skill requires a non-empty description; prompt description must be text",
        );
      if (
        metadata["disable-model-invocation"] !== undefined &&
        typeof metadata["disable-model-invocation"] !== "boolean"
      )
        fail(file.path, "invalid", "disable-model-invocation must be boolean");
      const common = { name, description, path: file.path, content: body };
      if (file.kind === "skill")
        skills.push(
          Object.freeze({
            ...common,
            hidden: metadata["disable-model-invocation"] === true,
          }),
        );
      else prompts.push(Object.freeze(common));
    } catch (error) {
      options.signal?.throwIfAborted();
      diagnostics.push(diagnostic(file.path, error));
    }
  }
  if (diagnostics.length)
    return { ok: false, diagnostics: Object.freeze(diagnostics) };
  return {
    ok: true,
    diagnostics: [],
    snapshot: Object.freeze({
      instructions: Object.freeze(instructions),
      skills: Object.freeze(skills),
      prompts: Object.freeze(prompts),
    }),
  };
}

export function substituteArgs(content: string, input: string) {
  const args: string[] = [];
  let current = "",
    quote = "",
    started = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  const all = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (
      _match,
      target: string,
      fallback: string,
      start: string,
      length: string,
      simple: string,
    ) => {
      if (target)
        return (
          (target === "@" || target === "ARGUMENTS"
            ? all
            : args[Number(target) - 1]) || fallback
        );
      if (start) {
        const from = Math.max(0, Number(start) - 1);
        return args
          .slice(from, length ? from + Number(length) : undefined)
          .join(" ");
      }
      return simple === "@" || simple === "ARGUMENTS"
        ? all
        : (args[Number(simple) - 1] ?? "");
    },
  );
}
function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pure expansion against approved bytes; never reopens a path during a request. */
export function expandInput(text: string, snapshot: ResourceSnapshot): string {
  if (text.startsWith("/skill:")) {
    const space = text.indexOf(" "),
      name = space < 0 ? text.slice(7) : text.slice(7, space);
    const skill = snapshot.skills.find((item) => item.name === name);
    if (skill) {
      const block = `<skill name="${xml(skill.name)}" location="${xml(skill.path)}">\nReferences are relative to ${dirname(skill.path)}.\n\n${skill.content.trim()}\n</skill>`;
      const args = space < 0 ? "" : text.slice(space + 1).trim();
      return args ? `${block}\n\n${args}` : block;
    }
  }
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return text;
  const template = snapshot.prompts.find((item) => item.name === match[1]);
  return template === undefined
    ? text
    : substituteArgs(template.content, match[2] ?? "");
}

/** Native sections capture a validated snapshot; construction also works without a model. */
export function createResourcesExtension(snapshot: ResourceSnapshot) {
  const instructions = snapshot.instructions
    .map((file) => `# ${file.path}\n${file.content}`)
    .join("\n\n");
  const skills = snapshot.skills
    .filter((skill) => !skill.hidden)
    .map(
      (skill) =>
        `<skill><name>${xml(skill.name)}</name><description>${xml(skill.description)}</description><location>${xml(skill.path)}</location></skill>`,
    )
    .join("\n");
  return defineExtension({
    name: "pig.resources",
    sections: [
      section("project-instructions", () => instructions || undefined),
      section("skills", () => skills || undefined),
      section("cwd", (input) => input.env?.cwd),
    ],
  });
}

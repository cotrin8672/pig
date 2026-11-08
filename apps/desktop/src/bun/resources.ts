import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";
import type { Settings } from "../shared/settings";
import { desktopConfigDir } from "./desktop-config";
import { currentSettings } from "./settings";

async function textFile(path: string) {
  try {
    if ((await stat(path)).isFile())
      return (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  } catch {
    // Missing, unreadable, or broken linked resources do not prevent a request.
  }
  return undefined;
}

function frontmatter(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { metadata: {} as Record<string, unknown>, body: text };
  const parsed = Bun.YAML.parse(match[1] ?? "");
  return {
    metadata: (parsed && typeof parsed === "object" ? parsed : {}) as Record<
      string,
      unknown
    >,
    body: text.slice(match[0].length),
  };
}

const contextNames = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];
async function contextFile(directory: string) {
  for (const name of contextNames) {
    const path = join(directory, name);
    const content = await textFile(path);
    if (content !== undefined) return { path, content };
  }
  return undefined;
}

function ancestors(cwd: string) {
  const paths = [resolve(cwd)];
  let directory = resolve(cwd);
  while (dirname(directory) !== directory) {
    directory = dirname(directory);
    paths.unshift(directory);
  }
  return paths;
}

// A nested linked worktree replaces the main checkout's same-named context file.
async function shadowedContext(cwd: string) {
  for (const directory of ancestors(cwd).reverse()) {
    const git = await textFile(join(directory, ".git"));
    if (!git?.startsWith("gitdir:")) continue;
    const gitDir = resolve(directory, git.slice(7).trim());
    const common = await textFile(join(gitDir, "commondir"));
    if (!common) return undefined;
    const main = dirname(resolve(gitDir, common.trim()));
    if (!relative(main, directory).startsWith("..") && main !== directory) {
      const own = await contextFile(directory);
      if (own) return join(await realpath(main), basename(own.path));
    }
    return undefined;
  }
  return undefined;
}

export async function loadContextFiles(
  cwd: string,
  globalDir = desktopConfigDir,
) {
  const files: { path: string; content: string }[] = [];
  const shadowed = await shadowedContext(cwd);
  for (const directory of [resolve(globalDir), ...ancestors(cwd)]) {
    const file = await contextFile(directory);
    if (!file || files.some((existing) => existing.path === file.path))
      continue;
    if (
      shadowed &&
      join(await realpath(directory), basename(file.path)) === shadowed
    )
      continue;
    files.push(file);
  }
  return files;
}

type Skill = {
  name: string;
  description: string;
  path: string;
  hidden: boolean;
};

async function directoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

// The old defaults are global skills and cwd/.pi/skills, not .agents/skills.
export async function loadSkills(cwd: string, globalDir = desktopConfigDir) {
  const skills = new Map<string, Skill>();
  const seen = new Set<string>();
  async function walk(
    directory: string,
    root: boolean,
    rules: { base: string; pattern: string }[] = [],
  ) {
    let canonical: string;
    try {
      canonical = await realpath(directory);
    } catch {
      return;
    }
    if (seen.has(canonical)) return;
    seen.add(canonical);
    rules = [...rules];
    for (const name of [".gitignore", ".ignore", ".fdignore"]) {
      const content = await textFile(join(directory, name));
      for (const pattern of content?.split(/\r?\n/) ?? [])
        if (pattern.trim() && !pattern.startsWith("#"))
          rules.push({ base: directory, pattern: pattern.trim() });
    }
    function ignored(path: string, isDirectory: boolean) {
      let ignore = false;
      for (const rule of rules) {
        const negated = rule.pattern.startsWith("!");
        let pattern = negated ? rule.pattern.slice(1) : rule.pattern;
        const directoryOnly = pattern.endsWith("/");
        if (directoryOnly && !isDirectory) continue;
        pattern = pattern.replace(/^\//, "").replace(/\/$/, "");
        const target = relative(rule.base, path).replace(/\\/g, "/");
        if (
          new Bun.Glob(pattern).match(target) ||
          (!pattern.includes("/") &&
            new Bun.Glob(pattern).match(basename(path)))
        )
          ignore = !negated;
      }
      return ignore;
    }
    async function add(path: string) {
      const raw = await textFile(path);
      if (raw === undefined) return;
      try {
        const { metadata } = frontmatter(raw);
        if (
          typeof metadata.description !== "string" ||
          !metadata.description.trim()
        )
          return;
        const name =
          typeof metadata.name === "string" && metadata.name
            ? metadata.name
            : basename(dirname(path));
        if (!skills.has(name))
          skills.set(name, {
            name,
            description: metadata.description,
            path,
            hidden: metadata["disable-model-invocation"] === true,
          });
      } catch {
        /* Invalid frontmatter is not a skill. */
      }
    }
    const declared = join(directory, "SKILL.md");
    if ((await textFile(declared)) !== undefined && !ignored(declared, false)) {
      await add(declared);
      return;
    }
    for (const entry of await directoryEntries(directory)) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      try {
        const info = await stat(path);
        if (ignored(path, info.isDirectory())) continue;
        if (info.isDirectory()) await walk(path, false, rules);
        else if (root && info.isFile() && entry.name.endsWith(".md"))
          await add(path);
      } catch {
        /* Broken links are ignored. */
      }
    }
  }
  await walk(join(globalDir, "skills"), true);
  await walk(join(cwd, ".pi", "skills"), true);
  return [...skills.values()];
}

export async function loadTemplates(cwd: string, globalDir = desktopConfigDir) {
  const templates = new Map<string, string>();
  for (const directory of [
    join(globalDir, "prompts"),
    join(cwd, ".pi", "prompts"),
  ]) {
    for (const entry of await directoryEntries(directory)) {
      if (!entry.name.endsWith(".md")) continue;
      const text = await textFile(join(directory, entry.name));
      if (text === undefined) continue;
      try {
        const name = basename(entry.name, ".md");
        if (!templates.has(name)) templates.set(name, frontmatter(text).body);
      } catch {
        /* Invalid frontmatter is not a template. */
      }
    }
  }
  return templates;
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

export async function expandInput(
  text: string,
  cwd: string,
  globalDir = desktopConfigDir,
) {
  if (text.startsWith("/skill:")) {
    const space = text.indexOf(" ");
    const name = space < 0 ? text.slice(7) : text.slice(7, space);
    const skill = (await loadSkills(cwd, globalDir)).find(
      (skill) => skill.name === name,
    );
    if (skill) {
      const raw = await textFile(skill.path);
      if (raw !== undefined) {
        const block = `<skill name="${skill.name}" location="${skill.path}">\nReferences are relative to ${dirname(skill.path)}.\n\n${frontmatter(raw).body.trim()}\n</skill>`;
        const args = space < 0 ? "" : text.slice(space + 1).trim();
        text = args ? `${block}\n\n${args}` : block;
      }
    }
  }
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return text;
  const template = (await loadTemplates(cwd, globalDir)).get(match[1] ?? "");
  return template === undefined
    ? text
    : substituteArgs(template, match[2] ?? "");
}

function xml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function codingResources(
  globalDir = desktopConfigDir,
  settings: () => Settings = currentSettings,
) {
  async function custom(cwd: string | undefined, name: string) {
    return (
      (cwd ? await textFile(join(cwd, ".pi", name)) : undefined) ??
      (await textFile(join(globalDir, name)))
    );
  }
  return defineExtension({
    name: "desktop-coding-prompt",
    sections: [
      section("shell", () =>
        settings().shell === "powershell"
          ? "The bash tool runs PowerShell, not Bash. Use PowerShell syntax and cmdlets (for example Write-Output, Get-ChildItem, $env:NAME); do not use POSIX shell syntax. Commands run with -NoProfile -NonInteractive -Command."
          : "The bash tool runs Git Bash on Windows (Bash on other platforms). Use POSIX/Bash syntax.",
      ),
      section(
        "preamble",
        async ({ agent }) =>
          (await custom(agent.cwd, "SYSTEM.md")) ||
          "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.",
        { tag: false },
      ),
      section("tools", async ({ agent }) => {
        if (await custom(agent.cwd, "SYSTEM.md")) return undefined;
        return `${agent.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")}\n\nAdditional tools may be available.`;
      }),
      section("rules", async ({ agent }) => {
        if (await custom(agent.cwd, "SYSTEM.md")) return undefined;
        const guidance: Record<string, string[]> = {
          read: ["Use read to examine files instead of cat or sed."],
          edit: [
            "Use edit for targeted changes. Batch changes to one file in a single call.",
            "Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions.",
          ],
          write: ["Use write only for new files or complete rewrites."],
        };
        return [
          agent.tools.some((tool) => tool.name === "bash")
            ? "Use the bash tool for shell commands, using the syntax specified in the shell section."
            : "",
          ...agent.tools.flatMap((tool) => guidance[tool.name] ?? []),
          "Be concise in your responses",
          "Show file paths clearly when working with files",
        ]
          .filter(Boolean)
          .map((rule) => `- ${rule}`)
          .join("\n");
      }),
      section("addendum", ({ agent }) => custom(agent.cwd, "APPEND_SYSTEM.md")),
      section("project_context", async ({ agent }) => {
        const files = await loadContextFiles(
          agent.cwd ?? process.cwd(),
          globalDir,
        );
        return files.length
          ? [
              "Project-specific instructions and guidelines:",
              ...files.map(
                ({ path, content }) =>
                  `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
              ),
            ].join("\n\n")
          : undefined;
      }),
      section("skills", async ({ agent }) => {
        const reader =
          ["read", "bash"].find((name) =>
            agent.tools.some((tool) => tool.name === name),
          ) ??
          (["read", "bash"].some((name) =>
            agent.callable.some((tool) => tool.name === name),
          )
            ? "indirect"
            : undefined);
        if (!reader) return undefined;
        const skills = (
          await loadSkills(agent.cwd ?? process.cwd(), globalDir)
        ).filter((skill) => !skill.hidden);
        return skills.length
          ? [
              "The following skills provide specialized instructions for specific tasks.",
              reader === "indirect"
                ? "Load a skill's file when the task matches its description."
                : `Use ${reader === "read" ? "the read tool" : "bash"} to load a skill's file when the task matches its description.`,
              "Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
              "<available_skills>",
              ...skills.map(
                (skill) =>
                  `<skill>\n<name>${xml(skill.name)}</name>\n<description>${xml(skill.description)}</description>\n<location>${xml(skill.path)}</location>\n</skill>`,
              ),
              "</available_skills>",
            ].join("\n")
          : undefined;
      }),
      section("cwd", ({ agent }) => agent.cwd?.replace(/\\/g, "/")),
      section(
        "date",
        () => `Current date: ${new Date().toISOString().slice(0, 10)}`,
      ),
    ],
  });
}

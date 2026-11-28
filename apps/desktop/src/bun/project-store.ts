import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { withoutProject } from "../shared/projects";
import { writeAtomicJson } from "./atomic-json";
import { validateSessionScope } from "./session-scope";

function pathKey(cwd: string) {
  const path = resolve(cwd);
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Registered project folders (`projects.json`), saved atomically in order. */
export class ProjectStore {
  private projects: string[] = [];
  private corrupt = false;
  private queue = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly generalCwd: string,
    private readonly onChange: (projects: string[]) => void,
  ) {}
  get value(): string[] {
    return this.projects;
  }
  async load() {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(saved) || !saved.every((p) => typeof p === "string"))
        throw new Error("Invalid projects file");
      this.projects = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.corrupt = true;
        console.error("Cannot load projects:", error);
      }
    }
  }
  find(cwd: string) {
    const key = pathKey(cwd);
    return [this.generalCwd, ...this.projects].find(
      (existing) => pathKey(existing) === key,
    );
  }
  async register(cwd: string, check?: () => void) {
    let registered = cwd;
    await this.save((current) => {
      check?.();
      const existing = this.find(cwd);
      if (!existing) return [...current, cwd];
      registered = existing;
      return current;
    });
    return registered;
  }
  remove(cwd: unknown) {
    return this.save((current) => withoutProject(current, cwd));
  }
  private save(change: (current: string[]) => string[]) {
    const save = this.queue.then(async () => {
      const next = change(this.projects);
      if (next === this.projects) return next;
      if (this.corrupt) {
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.corrupt = false;
      }
      await writeAtomicJson(this.file, next);
      this.projects = next;
      this.onChange(next);
      return next;
    });
    this.queue = save.then(
      () => {},
      () => {},
    );
    return save;
  }
  validateScope(cwd: string) {
    return validateSessionScope(cwd, this.projects, this.generalCwd);
  }
}

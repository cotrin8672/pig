import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateSessionScope } from "./session-scope";

/** Registered project folders (`projects.json`), saved atomically in order. */
export class ProjectStore {
  private projects: string[] = [];
  private corrupt = false;
  private queue = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly generalCwd: string,
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
  save(change: (current: string[]) => string[]) {
    const save = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      if (this.corrupt) {
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.corrupt = false;
      }
      const next = change(this.projects);
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next));
      await rename(temporary, this.file);
      this.projects = next;
      return this.projects;
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

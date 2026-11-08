import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { modelKey } from "../shared/models";

export class ModelPreferences {
  disabled: string[] = [];
  private queue = Promise.resolve();
  constructor(private file: string) {}

  async load() {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (
        !Array.isArray(value) ||
        !value.every((key) => typeof key === "string")
      )
        throw new Error("Invalid model preferences");
      this.disabled = [...new Set(value)];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  setEnabled(provider: string, id: string, enabled: boolean) {
    return this.setManyEnabled(provider, [id], enabled);
  }

  setManyEnabled(provider: string, ids: readonly string[], enabled: boolean) {
    const keys = new Set(ids.map((id) => modelKey({ provider, id })));
    const save = this.queue.then(async () => {
      const next = this.disabled.filter((entry) => !keys.has(entry));
      if (!enabled) next.push(...keys);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next));
      await rename(temporary, this.file);
      this.disabled = next;
      return next;
    });
    this.queue = save.then(
      () => {},
      () => {},
    );
    return save;
  }
}

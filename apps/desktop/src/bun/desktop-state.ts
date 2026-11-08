import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type DesktopState,
  validateDesktopState,
  validateSessionFlags,
  validateUiPreferences,
} from "../shared/desktop-state";
import { validateProjectFlags } from "../shared/projects";

export class DesktopStateStore {
  value: DesktopState = { sessions: {} };
  private queue = Promise.resolve();
  private corrupt = false;
  constructor(
    private file: string,
    private onChange?: (state: DesktopState) => void,
  ) {}
  async settled() {
    let pending: Promise<void>;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
    return this.value;
  }

  async load() {
    try {
      this.value = validateDesktopState(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.corrupt = true;
      console.error(
        "Cannot load desktop state; preserving the original file:",
        error,
      );
    }
  }
  private update(change: (current: DesktopState) => DesktopState) {
    const save = this.queue.then(async () => {
      const next = validateDesktopState(change(this.value));
      await mkdir(dirname(this.file), { recursive: true });
      if (this.corrupt) {
        await rename(this.file, `${this.file}.corrupt-${crypto.randomUUID()}`);
        this.corrupt = false;
      }
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next));
      await rename(temporary, this.file);
      this.value = next;
      this.onChange?.(next);
      return next;
    });
    this.queue = save.then(
      () => {},
      () => {},
    );
    return save;
  }
  setProject(cwd: string, value: unknown) {
    const patch = validateProjectFlags(value);
    return this.update((current) => {
      const flags = { ...current.projects?.[cwd], ...patch };
      const next = {
        ...(flags.name ? { name: flags.name } : {}),
        ...(flags.pinned ? { pinned: true } : {}),
        ...(flags.archived ? { archived: true } : {}),
      };
      const projects = { ...current.projects };
      if (Object.keys(next).length) projects[cwd] = next;
      else delete projects[cwd];
      return { ...current, projects };
    });
  }
  setUiPreferences(value: unknown) {
    const patch = validateUiPreferences(value);
    return this.update((current) => ({ ...current, ...patch }));
  }
  setSession(id: string, value: unknown) {
    const validated = validateSessionFlags(value);
    const patch = {
      ...(validated.pinned !== undefined ? { pinned: validated.pinned } : {}),
      ...(validated.archived !== undefined
        ? { archived: validated.archived }
        : {}),
    };
    if (!Object.keys(patch).length)
      throw new Error("Choose a session state to change.");
    return this.update((current) => {
      const flags = { ...current.sessions[id], ...patch };
      const next = {
        ...(flags.pinned ? { pinned: true } : {}),
        ...(flags.archived ? { archived: true } : {}),
        ...(flags.completion ? { completion: flags.completion } : {}),
        ...(flags.readCompletionId
          ? { readCompletionId: flags.readCompletionId }
          : {}),
      };
      const sessions = { ...current.sessions };
      if (Object.keys(next).length) sessions[id] = next;
      else delete sessions[id];
      return { ...current, sessions };
    });
  }
  completeSession(id: string, outcome: "success" | "error") {
    const completion = { id: crypto.randomUUID(), outcome };
    return this.update((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [id]: { ...current.sessions[id], completion },
      },
    }));
  }
  clearCompletion(id: string) {
    return this.update((current) => {
      const {
        completion: _completion,
        readCompletionId: _read,
        ...flags
      } = current.sessions[id] ?? {};
      const sessions = { ...current.sessions };
      if (Object.keys(flags).length) sessions[id] = flags;
      else delete sessions[id];
      return { ...current, sessions };
    });
  }
  markSessionRead(id: string, completionId: string) {
    if (
      typeof completionId !== "string" ||
      !completionId ||
      completionId.length > 128
    )
      throw new Error("Invalid completion ID.");
    return this.update((current) => {
      const flags = current.sessions[id];
      if (flags?.completion?.id !== completionId) return current;
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [id]: { ...flags, readCompletionId: completionId },
        },
      };
    });
  }
  forgetSession(id: string) {
    return this.update((current) => {
      const sessions = { ...current.sessions };
      delete sessions[id];
      return { ...current, sessions };
    });
  }
}

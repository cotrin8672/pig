import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCredentials } from "./credentials";

test("pig credentials serialize updates, survive reopen and preserve corrupt files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-auth-"));
  const file = join(directory, "auth.json");
  try {
    const store = new FileCredentials(file);
    expect(await store.list()).toEqual([]);
    await Promise.all([
      store.modify("one", async () => ({ type: "api_key", key: "one" })),
      store.modify("two", async () => ({ type: "api_key", key: "two" })),
    ]);
    expect(await new FileCredentials(file).list()).toHaveLength(2);
    await expect(
      store.modify("one", async () => {
        throw new Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    expect(await store.read("one")).toEqual({ type: "api_key", key: "one" });
    await store.delete("one");
    expect(await store.read("one")).toBeUndefined();
    expect(await store.read("two")).toEqual({ type: "api_key", key: "two" });
    await writeFile(file, "{broken");
    await expect(
      store.modify("one", async () => ({ type: "api_key", key: "new" })),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential cancellation is checked after the queue and before callback/write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-auth-cancel-"));
  try {
    const store = new FileCredentials(join(directory, "auth.json"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = store.modify("one", async () => {
      await blocked;
      return { type: "api_key", key: "one" };
    });
    const controller = new AbortController();
    let called = false;
    const second = store.modify(
      "two",
      async () => {
        called = true;
        return { type: "api_key", key: "two" };
      },
      { signal: controller.signal },
    );
    controller.abort();
    release();
    await first;
    await expect(second).rejects.toThrow();
    expect(called).toBe(false);
    expect(await store.read("two")).toBeUndefined();
    await expect(
      store.read("one", { signal: controller.signal }),
    ).rejects.toThrow();
    await expect(store.list({ signal: controller.signal })).rejects.toThrow();
    await expect(
      store.delete("one", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(await store.read("one")).toBeDefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("independent credential store instances lock the entire mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-auth-lock-"));
  try {
    const file = join(directory, "auth.json");
    const stores = Array.from({ length: 8 }, () => new FileCredentials(file));
    await Promise.all(
      stores.map((store) =>
        store.modify("count", async (current) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            type: "api_key",
            key: String(
              Number(current?.type === "api_key" ? current.key : 0) + 1,
            ),
          };
        }),
      ),
    );
    expect(await stores[0].read("count")).toEqual({
      type: "api_key",
      key: "8",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved commands resolve only on read, listing/mutations never execute, raw command remains saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-auth-command-"));
  try {
    const file = join(directory, "auth.json");
    const store = new FileCredentials(file);
    await store.modify("command", async () => ({
      type: "api_key",
      key: "!echo saved-secret",
    }));
    expect(await store.list()).toEqual([
      { providerId: "command", type: "api_key" },
    ]);
    expect(await store.read("command")).toEqual({
      type: "api_key",
      key: "saved-secret",
    });
    await store.modify("command", async (current) => {
      expect(current).toEqual({ type: "api_key", key: "!echo saved-secret" });
      return undefined;
    });
    expect(await readFile(file, "utf8")).toContain("!echo saved-secret");
    await store.modify("bad", async () => ({
      type: "api_key",
      key: "!exit 1",
    }));
    expect(await store.list()).toHaveLength(2);
    await expect(store.read("bad")).rejects.toThrow("Failed to resolve");
    await store.modify("ambient", async () => ({
      type: "api_key",
      key: "$OPENAI_API_KEY",
    }));
    await expect(store.read("ambient")).rejects.toThrow(
      "Environment references",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential mutations exclude other processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pig-auth-processes-"));
  try {
    const file = join(directory, "auth.json");
    const script = `
      import { FileCredentials } from ${JSON.stringify(new URL("./credentials.ts", import.meta.url).href)};
      const store = new FileCredentials(${JSON.stringify(file)});
      for (let i = 0; i < 3; i++) await store.modify("counter", async current => {
        await new Promise(r => setTimeout(r, 5));
        return {type: "api_key", key: String(Number(current?.key ?? 0) + 1)};
      });
    `;
    const children = Array.from({ length: 4 }, () =>
      Bun.spawn([process.execPath, "--eval", script], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const results = await Promise.all(
      children.map(async (child) => ({
        code: await child.exited,
        stderr: await new Response(child.stderr).text(),
      })),
    );
    expect(results).toEqual(
      Array.from({ length: 4 }, () => ({ code: 0, stderr: "" })),
    );
    expect(await new FileCredentials(file).read("counter")).toEqual({
      type: "api_key",
      key: "12",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

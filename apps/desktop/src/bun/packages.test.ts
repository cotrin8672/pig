import { expect, test } from "bun:test";
import { PromptQueue, withPackageLock } from "./package-queue";
import {
  mapSearchItem,
  packageOperation,
  packagePreviews,
  parsePreviews,
  repoUrl,
  searchPackages,
} from "./packages";

test("repository links normalize git transports and fall back only to GitHub", () => {
  expect(repoUrl("git+https://github.com/a/b.git")).toBe(
    "https://github.com/a/b",
  );
  expect(repoUrl("git://github.com/a/b.git")).toBe("https://github.com/a/b");
  expect(repoUrl(undefined, "https://github.com/a/b")).toBe(
    "https://github.com/a/b",
  );
  expect(repoUrl("javascript:alert(1)", "https://example.com")).toBeUndefined();
});
test("search cards map keywords, publisher and optional download counts", () => {
  const card = mapSearchItem({
    package: {
      name: "example",
      version: "1",
      keywords: ["pi-extension", "skills"],
      publisher: { username: "author" },
      links: { npm: "https://npmjs.com/package/example" },
    },
    downloads: { monthly: 42 },
  });
  expect(card).toMatchObject({
    name: "example",
    version: "1",
    types: ["extension", "skill"],
    publisher: "author",
    monthlyDownloads: 42,
  });
  expect(mapSearchItem({ package: {} }).monthlyDownloads).toBe(0);
});
test("previews accept only requested HTTPS images and fill missing names with null", () => {
  expect(
    parsePreviews(
      {
        previews: [
          {
            name: "a",
            media: { type: "image", url: "https://example.com/a.png" },
          },
          {
            name: "b",
            media: { type: "image", url: "http://example.com/b.png" },
          },
          { name: "c", media: { type: "video", url: "https://example.com/c" } },
          {
            name: "extra",
            media: { type: "image", url: "https://example.com" },
          },
        ],
      },
      ["a", "b", "c", "missing"],
    ),
  ).toEqual({
    a: "https://example.com/a.png",
    b: null,
    c: null,
    missing: null,
  });
  expect(parsePreviews(null, ["a"])).toEqual({ a: null });
});
test("untrusted search and preview inputs fail before fetching", async () => {
  await expect(
    searchPackages({ query: "x".repeat(201), page: 0 }),
  ).rejects.toThrow();
  await expect(searchPackages({ query: "", page: -1 })).rejects.toThrow();
  await expect(searchPackages({ query: "", page: 200 })).rejects.toThrow();
  await expect(searchPackages(null)).rejects.toThrow();
  await expect(
    packagePreviews({ names: Array(65).fill("a") }),
  ).rejects.toThrow();
});
test("resource queue serializes work and recovers after errors", async () => {
  const events: number[] = [];
  const first = withPackageLock(async () => {
    await Promise.resolve();
    events.push(1);
    throw new Error("expected");
  });
  const second = withPackageLock(async () => {
    events.push(2);
  });
  await expect(first).rejects.toThrow("expected");
  await second;
  expect(events).toEqual([1, 2]);
});

const fakeDependencies = (mutate = async () => {}) => ({
  configured: async () => [],
  mutate,
  installed: async () => [],
});
test("package operations reject unsafe names, unconfigured sources and bad IDs", async () => {
  for (const name of ["-x", "a@1", "../x", "Uppercase"]) {
    await expect(
      packageOperation(
        "install",
        { opId: "test", name },
        () => {},
        () => {},
        async () => {},
        () => {},
        fakeDependencies(),
      ),
    ).rejects.toThrow("Invalid npm package name");
  }
  for (const action of ["update", "uninstall"] as const) {
    await expect(
      packageOperation(
        action,
        { opId: "test", source: "npm:unknown" },
        () => {},
        () => {},
        async () => {},
        () => {},
        fakeDependencies(),
      ),
    ).rejects.toThrow("not configured");
  }
  for (const opId of [undefined, "", 1, "x".repeat(201)]) {
    await expect(
      packageOperation(
        "install",
        { opId, name: "x" },
        () => {},
        () => {},
        async () => {},
        () => {},
        fakeDependencies(),
      ),
    ).rejects.toThrow("operation ID");
  }
});
test("persisted mutations finish and warn after reload failures", async () => {
  for (const reload of [
    async () => ["chat: broken"],
    async () => {
      throw new Error("broken");
    },
  ]) {
    const events: string[] = [];
    await packageOperation(
      "install",
      { opId: "test", name: "x" },
      (event) => events.push(event.status),
      () => {
        events.push("installed");
      },
      reload,
      (warning) => {
        events.push("warning");
        expect(warning).toContain(
          "Installed npm:x, but reloading 1 open chat(s) failed:",
        );
      },
      fakeDependencies(),
    );
    expect(events).toEqual(["running", "installed", "done", "warning"]);
  }
});
test("mutation failures emit running then error with action and source", async () => {
  const events: string[] = [];
  await expect(
    packageOperation(
      "install",
      { opId: "test", name: "x" },
      (event) => events.push(event.status),
      () => {
        throw new Error("must not push");
      },
      async () => {
        throw new Error("must not reload");
      },
      () => {},
      fakeDependencies(async () => {
        throw new Error("npm failed with code 1");
      }),
    ),
  ).rejects.toThrow("install failed for npm:x: npm failed with code 1");
  expect(events).toEqual(["running", "error"]);
});
test("ENOENT only diagnoses npm when the missing command refers to npm", async () => {
  for (const path of ["npm.cmd", "settings.json"]) {
    const failure = Object.assign(new Error(`spawn ${path} ENOENT`), {
      code: "ENOENT",
      path,
    });
    await expect(
      packageOperation(
        "install",
        { opId: "test", name: "x" },
        () => {},
        () => {},
        async () => {},
        () => {},
        fakeDependencies(async () => {
          throw failure;
        }),
      ),
    ).rejects.toThrow(
      path === "npm.cmd" ? "npm was not found" : "settings.json",
    );
  }
});
test("abort skips a queued prompt but allows a subsequent prompt", async () => {
  const queue = new PromptQueue();
  const session = {};
  let release = () => {};
  const blocker = withPackageLock(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  let calls = 0;
  const pending = queue.start(session, async () => {
    calls++;
  });
  queue.abort(session);
  release();
  await blocker;
  await pending;
  expect(calls).toBe(0);
  await queue.start(session, async () => {
    calls++;
  });
  expect(calls).toBe(1);
});
test("installed enrichment does not hold the resource lock", async () => {
  let release = () => {};
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const operation = packageOperation(
    "install",
    { opId: "test", name: "x" },
    () => {},
    () => {},
    async () => {},
    () => {},
    {
      ...fakeDependencies(),
      installed: async () => {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [];
      },
    },
  );
  await ready;
  await withPackageLock(async () => {
    release();
  });
  await operation;
});
test("preview failures retry and overlapping requests share in-flight names", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    await Promise.resolve();
    return calls === 1
      ? new Response("unavailable", { status: 503 })
      : Response.json({ previews: [] });
  }) as unknown as typeof fetch;
  try {
    await Promise.all([
      packagePreviews({ names: ["test-retry"] }),
      packagePreviews({ names: ["test-retry"] }),
    ]);
    expect(calls).toBe(1);
    await packagePreviews({ names: ["test-retry"] });
    expect(calls).toBe(2);
    await packagePreviews({ names: ["test-retry"] });
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = original;
  }
});
test("oversized registry responses are rejected", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(" ".repeat(5 * 1024 * 1024 + 1))) as unknown as typeof fetch;
  try {
    await expect(
      searchPackages({ query: "size-test", page: 0 }),
    ).rejects.toThrow("exceeds 5 MB");
  } finally {
    globalThis.fetch = original;
  }
});

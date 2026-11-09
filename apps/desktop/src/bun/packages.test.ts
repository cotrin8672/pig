import { expect, test } from "bun:test";
import {
  catalogPreviews,
  type DurableCatalogEntry,
  durablePackageCatalog,
  searchCatalog,
} from "./durable-package-catalog";
import { PackageManagerError } from "./durable-package-manager";
import { PromptQueue, withPackageLock } from "./package-queue";
import { packageOperation, packagePreviews, searchPackages } from "./packages";

const fakeDependencies = (
  mutate = async (_action: string, _source: string) => {},
) => ({ mutate, listInstalled: async () => [] });

test("production catalog is empty; local search and previews never use the network", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("read paths must not fetch");
  }) as unknown as typeof fetch;
  try {
    expect(durablePackageCatalog).toEqual([]);
    for (const query of ["", "private"])
      expect(await searchPackages({ query, page: 0 })).toEqual({
        items: [],
        total: 0,
        pageSize: 50,
      });
    expect(
      await packagePreviews({ names: ["example", "example", "__proto__"] }),
    ).toEqual({ example: null, ["__proto__"]: null });
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

test("synthetic catalog filters case-insensitively, sorts deterministically and pages locally", () => {
  const catalog = Array.from(
    { length: 55 },
    (_, index): DurableCatalogEntry => ({
      nativeCore: "1.5.0",
      target: `npm:example-${index}@1.0.0`,
      preview: index === 0 ? "/marketplace/example.png" : undefined,
      card: {
        name: `example-${String(index).padStart(2, "0")}`,
        version: "1.0.0",
        description: index === 0 ? "Unique description" : "local",
        publisher: "Author",
        date: "",
        monthlyDownloads: 0,
        types: ["extension"],
      },
    }),
  ).reverse();
  expect(
    searchCatalog({ query: " AUTHOR ", page: 0 }, catalog).items,
  ).toHaveLength(50);
  expect(
    searchCatalog({ query: "", page: 1 }, catalog).items.map(
      (item) => item.name,
    ),
  ).toEqual([
    "example-50",
    "example-51",
    "example-52",
    "example-53",
    "example-54",
  ]);
  expect(searchCatalog({ query: "unique", page: 0 }, catalog).total).toBe(1);
  expect(searchCatalog({ query: "missing", page: 0 }, catalog).total).toBe(0);
  expect(
    catalogPreviews({ names: ["example-00", "missing"] }, catalog),
  ).toEqual({ "example-00": "/marketplace/example.png", missing: null });
});

test("bounded read inputs reject malformed queries and preview requests", async () => {
  for (const input of [
    null,
    { query: "x".repeat(201), page: 0 },
    { query: "", page: -1 },
    { query: "", page: 200 },
    { query: "", page: 0.5 },
  ])
    await expect(searchPackages(input)).rejects.toThrow(
      "Invalid package search",
    );
  for (const names of [Array(65).fill("a"), [""], [1], ["x".repeat(215)]])
    await expect(packagePreviews({ names })).rejects.toThrow(
      "Invalid preview names",
    );
});

test("operation inputs fail before mutation and never echo credential-bearing URLs", async () => {
  for (const name of [
    "-x",
    "../x",
    "Uppercase",
    "https://token-secret@github.com/a/b",
  ]) {
    const events: string[] = [];
    await expect(
      packageOperation(
        "install",
        { opId: "test", name },
        (event) => {
          events.push(event.status);
          expect(JSON.stringify(event)).not.toContain("token-secret");
        },
        () => {},
        () => {},
        fakeDependencies(async () => {
          throw new Error("must not mutate");
        }),
      ),
    ).rejects.toThrow("Invalid package source");
    expect(events).toEqual(["error"]);
  }
  for (const opId of [undefined, "", 1, "x".repeat(201)])
    await expect(
      packageOperation(
        "install",
        { opId, name: "x" },
        () => {},
        () => {},
        () => {},
        fakeDependencies(),
      ),
    ).rejects.toThrow("operation ID");
});

test("all actions preserve running/installed/done callbacks without loading code", async () => {
  for (const action of ["install", "update", "uninstall"] as const) {
    const events: string[] = [];
    await packageOperation(
      action,
      { opId: "test", name: "x", source: "npm:x" },
      (event) => {
        events.push(event.status);
        expect(event.source).toBe("npm:x");
      },
      () => {
        events.push("installed");
      },
      () => {},
      fakeDependencies(),
    );
    expect(events).toEqual(["running", "installed", "done"]);
  }
});

test("mutation failure emits running/error and hides arbitrary exception details", async () => {
  const events: string[] = [];
  await expect(
    packageOperation(
      "install",
      { opId: "test", name: "x" },
      (event) => {
        events.push(event.status);
        expect(JSON.stringify(event)).not.toContain("token-secret");
      },
      () => {
        throw new Error("must not push");
      },
      () => {},
      fakeDependencies(async () => {
        throw new Error("_authToken=token-secret");
      }),
    ),
  ).rejects.toThrow("could not complete");
  expect(events).toEqual(["running", "error"]);
  await expect(
    packageOperation(
      "update",
      { opId: "test", source: "npm:unknown" },
      () => {},
      () => {},
      () => {},
      fakeDependencies(async () => {
        throw new PackageManagerError("Package source is not configured");
      }),
    ),
  ).rejects.toThrow("not configured");
});

test("notifications can reenter the queue and recover after errors without deadlock", async () => {
  const events: number[] = [];
  const first = withPackageLock(async () => {
    events.push(1);
    throw new Error("expected");
  });
  const second = withPackageLock(async () => {
    events.push(2);
  });
  await expect(first).rejects.toThrow("expected");
  await second;
  expect(events).toEqual([1, 2]);
  await packageOperation(
    "install",
    { opId: "test", name: "x" },
    () => {},
    () => {},
    () => {},
    {
      mutate: () => withPackageLock(async () => {}),
      listInstalled: () => withPackageLock(async () => []),
    },
  );
});

test("a committed mutation still emits done if installed-list notification fails", async () => {
  const events: string[] = [];
  await packageOperation(
    "install",
    { opId: "test", name: "x" },
    (event) => {
      events.push(event.status);
    },
    () => {
      throw new Error("token-secret");
    },
    (message) => {
      expect(message).not.toContain("token-secret");
      events.push("warning");
    },
    fakeDependencies(),
  );
  expect(events).toEqual(["running", "warning", "done"]);
});

test("abort skips a queued prompt but permits a subsequent prompt", async () => {
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

test("manual URLs and explicit pins reach the install boundary without discovery or selector loss", async () => {
  for (const [name, request, source] of [
    [
      "https://github.com/personal/private#feature/work",
      "https://github.com/personal/private.git#feature/work",
      "https://github.com/personal/private.git",
    ],
    [
      "git@github.com:personal/private.git#v1.0.0",
      "ssh://git@github.com/personal/private.git#v1.0.0",
      "ssh://git@github.com/personal/private.git",
    ],
    [
      "https://npmjs.com/package/@personal/private/v/1.2.3/",
      "npm:@personal/private@1.2.3",
      "npm:@personal/private",
    ],
    [
      "npm:@personal/private@next",
      "npm:@personal/private@next",
      "npm:@personal/private",
    ],
  ]) {
    const calls: string[][] = [];
    const events: string[] = [];
    await packageOperation(
      "install",
      { opId: "manual", name },
      (event) => {
        events.push(event.status);
        expect(event.source).toBe(source);
      },
      () => {},
      () => {},
      fakeDependencies(async (action, input) => {
        calls.push([action, input]);
      }),
    );
    expect(calls).toEqual([["install", request]]);
    expect(events).toEqual(["running", "done"]);
  }
});

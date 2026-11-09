import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { dictionary, en, ja } from "../shared/i18n";
import type { PackageOpStatus } from "../shared/rpc-schema";
import { ManualPackageInstall } from "./ManualPackageInstall";
import {
  dispatchPackageOperation,
  findPackageOperation,
  guardPackageInstallKey,
  type PackageDispatchPorts,
} from "./manual-package-install";
import { useStore } from "./store";

function fixture() {
  const operations: Record<string, PackageOpStatus> = {};
  const events: PackageOpStatus[] = [];
  const sent: {
    method: string;
    input: { opId: string; name?: string; source?: string };
  }[] = [];
  const order: string[] = [];
  let sequence = 0;
  let transport: unknown;
  const send = (
    method: string,
    input: { opId: string; name?: string; source?: string },
  ) => {
    order.push("send");
    sent.push({ method, input });
    if (transport) throw transport;
  };
  const ports: PackageDispatchPorts = {
    operations: () => operations,
    emit: (event) => {
      order.push(event.status);
      events.push(event);
      operations[event.opId] = event;
    },
    newOpId: () => {
      order.push("id");
      return `operation-${++sequence}`;
    },
    messages: {
      invalid: en.manualPackageInvalid,
      transport: en.manualPackageDispatchFailed,
    },
    send: {
      installPackage: (input) => send("installPackage", input),
      uninstallPackage: (input) => send("uninstallPackage", input),
      updatePackage: (input) => send("updatePackage", input),
    },
  };
  return {
    operations,
    events,
    sent,
    order,
    ports,
    fail: (error: unknown) => {
      transport = error;
    },
    run: (input: string, action: PackageOpStatus["action"] = "install") =>
      dispatchPackageOperation(action, input, ports),
  };
}

for (const [input, request, source] of [
  ["example", "npm:example", "npm:example"],
  [
    "npm:example@1.2.3-beta.1+build.2",
    "npm:example@1.2.3-beta.1+build.2",
    "npm:example",
  ],
  [
    "@personal/private@next",
    "npm:@personal/private@next",
    "npm:@personal/private",
  ],
  [
    "npm:@personal/private@^1.2.0",
    "npm:@personal/private@^1.2.0",
    "npm:@personal/private",
  ],
  ["https://www.npmjs.com/package/example/", "npm:example", "npm:example"],
  [
    "https://npmjs.com/package/@personal/private/v/1.2.3/",
    "npm:@personal/private@1.2.3",
    "npm:@personal/private",
  ],
  [
    "https://github.com/Personal/Private#feature/one",
    "https://github.com/personal/private.git#feature/one",
    "https://github.com/personal/private.git",
  ],
  [
    "https://github.com/Personal/Private.git#refs/tags/v1.2.3",
    "https://github.com/personal/private.git#refs/tags/v1.2.3",
    "https://github.com/personal/private.git",
  ],
  [
    "git@github.com:Personal/Private.git#feature/one",
    "ssh://git@github.com/personal/private.git#feature/one",
    "ssh://git@github.com/personal/private.git",
  ],
  [
    "ssh://git@github.com/Personal/Private#main",
    "ssh://git@github.com/personal/private.git#main",
    "ssh://git@github.com/personal/private.git",
  ],
] as const) {
  test(`manual dispatch preserves npm pins/tags and Git refs: ${input}`, () => {
    const f = fixture();
    expect(f.run(input)).toEqual({
      status: "started",
      opId: "operation-1",
      source,
    });
    expect(f.events).toEqual([
      { opId: "operation-1", source, action: "install", status: "running" },
    ]);
    expect(f.sent).toEqual([
      {
        method: "installPackage",
        input: { opId: "operation-1", name: request },
      },
    ]);
    expect(f.order).toEqual(["id", "running", "send"]);
  });
}

test("all rejected/secret URLs are validated before ID, optimistic event or transport", () => {
  const f = fixture();
  for (const input of [
    "",
    "../local",
    "npm:x@npm:other",
    "npm:x@1 --bad",
    "https://github.com.evil/a/b",
    "https://user:SUPER_SECRET@github.com/a/b",
    "https://github.com/a/b?token=SUPER_SECRET",
    "https://SUPER_SECRET@www.npmjs.com/package/x",
    "https://npmjs.com/package/x?token=SUPER_SECRET/",
    "https://npmjs.com/package/x#SUPER_SECRET",
    "ssh://SUPER_SECRET@github.com/a/b",
    "https://github.com/a/b#foo/../bar",
    "https://github.com/a/b/tree/main",
  ]) {
    const result = f.run(input);
    expect(result).toEqual({
      status: "invalid",
      message: en.manualPackageInvalid,
    });
    expect(JSON.stringify(result)).not.toContain("SUPER_SECRET");
  }
  expect(f.order).toEqual([]);
  expect(f.events).toEqual([]);
  expect(f.sent).toEqual([]);
});

test("canonical duplicate submits reuse the in-flight ID without changing the first selector", () => {
  for (const [first, alias, source] of [
    [
      "npm:@personal/private@1.2.3",
      "https://npmjs.com/package/@personal/private/",
      "npm:@personal/private",
    ],
    [
      "git@github.com:Personal/Private.git#one",
      "ssh://git@github.com/personal/private#two",
      "ssh://git@github.com/personal/private.git",
    ],
  ]) {
    const f = fixture();
    f.run(first);
    expect(f.run(alias)).toEqual({
      status: "running",
      opId: "operation-1",
      source,
    });
    expect(f.run(first, "uninstall")).toMatchObject({
      status: "running",
      opId: "operation-1",
    });
    expect(f.sent).toHaveLength(1);
    expect(f.events).toHaveLength(1);
    expect(f.order).toEqual(["id", "running", "send"]);
  }
});

test("transport failure publishes only a safe error under the same ID; explicit retry retains the pin", () => {
  const f = fixture();
  let stringified = false;
  f.fail({
    toString() {
      stringified = true;
      return "https://user:SUPER_SECRET@github.com/a/b";
    },
  });
  expect(f.run("npm:example@2.3.4")).toEqual({
    status: "error",
    opId: "operation-1",
    source: "npm:example",
    message: en.manualPackageDispatchFailed,
  });
  expect(f.events.map((event) => [event.opId, event.status])).toEqual([
    ["operation-1", "running"],
    ["operation-1", "error"],
  ]);
  expect(JSON.stringify(f.events)).not.toContain("SUPER_SECRET");
  expect(stringified).toBe(false);
  f.fail(undefined);
  expect(f.run("npm:example@2.3.4")).toMatchObject({
    status: "started",
    opId: "operation-2",
  });
  expect(f.sent[1]).toEqual({
    method: "installPackage",
    input: { opId: "operation-2", name: "npm:example@2.3.4" },
  });
});

test("backend failure permits explicit retry, never automatic retry or optimistic activation", () => {
  const f = fixture();
  f.run("https://github.com/a/b#main");
  f.ports.emit({
    ...f.operations["operation-1"],
    status: "error",
    message: "Installation failed",
  });
  expect(f.sent).toHaveLength(1);
  expect(f.run("https://github.com/a/b.git#main")).toMatchObject({
    status: "started",
    opId: "operation-2",
  });
  expect(f.sent[1].input.name).toBe("https://github.com/a/b.git#main");
  f.ports.emit({ ...f.operations["operation-2"], status: "done" });
  expect(f.sent.map((item) => item.method)).toEqual([
    "installPackage",
    "installPackage",
  ]);
  expect(f.events.filter((event) => event.status === "done")).toHaveLength(1);
});

test("operation lookup canonicalizes pinned/npm forms and prefers running to completed", () => {
  const f = fixture();
  f.run("npm:example@1.2.3");
  f.ports.emit({
    opId: "old",
    source: "npm:example@0.1.0",
    action: "install",
    status: "done",
  });
  expect(
    findPackageOperation("https://www.npmjs.com/package/example", f.operations)
      ?.opId,
  ).toBe("operation-1");
  expect(
    findPackageOperation("https://secret@github.com/a/b", f.operations),
  ).toBeUndefined();
  expect(findPackageOperation("npm:other", f.operations)).toBeUndefined();
});

test("existing update/uninstall actions use the same validated dispatch without installing or reloading", () => {
  const f = fixture();
  f.run("npm:example@1.2.3", "update");
  f.run("git@github.com:a/b.git#release", "uninstall");
  expect(f.sent).toEqual([
    {
      method: "updatePackage",
      input: { opId: "operation-1", source: "npm:example@1.2.3" },
    },
    {
      method: "uninstallPackage",
      input: {
        opId: "operation-2",
        source: "ssh://git@github.com/a/b.git#release",
      },
    },
  ]);
});

test("the actual manual button key guard blocks IME, 229 and repeat defaults", () => {
  for (const extra of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ]) {
    let prevented = false;
    guardPackageInstallKey({
      nativeEvent: { isComposing: false, keyCode: 13, repeat: false, ...extra },
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  }
  let prevented = false;
  guardPackageInstallKey({
    nativeEvent: { isComposing: false, keyCode: 13, repeat: false },
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(false);
});

function render(
  operation?: PackageOpStatus,
  error?: string,
  source = "npm:example@1.2.3",
) {
  return renderToStaticMarkup(
    <ManualPackageInstall
      source={source}
      operation={operation}
      error={error}
      onSourceChange={() => {}}
      onInstall={() => {
        throw new Error("Rendering must not dispatch");
      }}
    />,
  );
}

test("manual entry SSR retains the source, explicit two-press trust button and accessible descriptions", () => {
  const t = dictionary(useStore.getState().settings.language);
  const html = render();
  expect(html).toContain('value="npm:example@1.2.3"');
  expect(html).toContain(t.manualPackageSource);
  expect(html).toContain(t.manualPackageHelp);
  expect(html).toContain("Git/SSH/npm");
  expect(html).toContain('type="button"');
  expect(html).toContain('class="confirm-armed"');
  expect(html).not.toContain("<form");
  expect(html).not.toContain('type="submit"');
  const sourceId = html.match(/<input id="([^"]+)"/)?.[1];
  expect(sourceId).toBeDefined();
  expect(html).toContain(`for="${sourceId}"`);
  for (const suffix of ["help", "trust", "status"])
    expect(html).toContain(
      `id="${sourceId?.replace(/-source$/, `-${suffix}`)}"`,
    );
  expect(html).toContain('aria-describedby="');
  expect(render(undefined, undefined, "")).toContain('disabled=""');
});

test("SSR progress/error/retry retain typed pins and done means installed only, not enabled", () => {
  const t = dictionary(useStore.getState().settings.language);
  const base = {
    opId: "manual",
    source: "npm:example",
    action: "install" as const,
  };
  const running = render({ ...base, status: "running" });
  expect(running).toContain('aria-busy="true"');
  expect(running).toContain(t["Installing…"]);
  expect(running.match(/disabled=""/g)).toHaveLength(2);
  expect(running).not.toContain(t.manualPackageInstalled);
  for (const html of [
    render({ ...base, status: "error", message: "Safe failure" }),
    render(undefined, "Safe failure"),
  ]) {
    expect(html).toContain('value="npm:example@1.2.3"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/id="[^"]+-error"[^>]*role="alert">Safe failure/);
    expect(html).toContain(t.Retry);
    expect(html).not.toContain('disabled=""');
  }
  const done = render({ ...base, status: "done" });
  expect(done).toContain(t.manualPackageInstalled);
  expect(done).toContain('role="status"');
  expect(done).toContain('value="npm:example@1.2.3"');
  expect(en.manualPackageInstalled).toContain("not automatically enabled");
  expect(ja.manualPackageInstalled).toContain("自動では有効化されません");
  for (const action of ["update", "uninstall"] as const) {
    expect(render({ ...base, action, status: "done" })).not.toContain(
      t.manualPackageInstalled,
    );
  }
});

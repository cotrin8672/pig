import type { Json } from "./index";
import { type SessionView, type ToolCard, viewActions } from "./models";

const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_ARRAY = 10_000;
const encoder = new TextEncoder();

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

/** Snapshot data without invoking getters/toJSON or silently losing non-JSON values. */
function snapshot(value: unknown): Json {
  let bytes = 0;
  const ancestors = new Set<object>();
  const count = (size: number) => {
    bytes += size;
    if (bytes > MAX_BYTES) fail("$", "JSON exceeds 1MB");
  };
  const stringSize = (text: string) => {
    if (text.length > MAX_BYTES) fail("$", "string exceeds 1MB");
    count(encoder.encode(JSON.stringify(text)).length);
  };
  function visit(input: unknown, path: string, depth: number): Json {
    if (depth > MAX_DEPTH) fail(path, "JSON depth exceeds 32");
    if (input === null || typeof input === "boolean") {
      count(input === null ? 4 : input ? 4 : 5);
      return input;
    }
    if (typeof input === "string") {
      stringSize(input);
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) fail(path, "expected finite number");
      count(String(input).length);
      return input;
    }
    if (typeof input !== "object") fail(path, "expected JSON value");
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      fail(path, "expected plain JSON object or array");
    if (ancestors.has(input)) fail(path, "cyclic JSON");
    ancestors.add(input);
    count(2);
    const keys = Reflect.ownKeys(input);
    if (array) {
      if (input.length > MAX_ARRAY) fail(path, "array exceeds 10000 items");
      if (keys.length !== input.length + 1)
        fail(path, "sparse array or extra array properties");
      const result: Json[] = [];
      for (let i = 0; i < input.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
        if (!descriptor?.enumerable || !("value" in descriptor))
          fail(path, "expected array data element");
        if (i) count(1);
        result.push(visit(descriptor.value, `${path}[${i}]`, depth + 1));
      }
      ancestors.delete(input);
      return result;
    }
    const result: { [key: string]: Json } = {};
    let first = true;
    for (const key of keys) {
      if (typeof key !== "string") fail(path, "symbol keys are not JSON");
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        fail(path, "expected enumerable data property");
      if (descriptor.value === undefined) continue;
      if (!first) count(1);
      first = false;
      stringSize(key);
      count(1);
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, `${path}.${key}`, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(input);
    return result;
  }
  return visit(value, "$", 0);
}

/** Undefined is only allowed for omitted object fields, never as the root. */
export function validateJson(value: unknown): void {
  snapshot(value);
}

type Check = (value: unknown, path: string) => void;
type Fields = Record<string, Check>;
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "expected object");
  return value as Record<string, unknown>;
}
function shape(required: Fields, optional: Fields = {}): Check {
  return (value, path) => {
    const item = record(value, path);
    for (const [key, check] of Object.entries(required)) {
      if (!Object.hasOwn(item, key)) fail(`${path}.${key}`, "required field");
      check(item[key], `${path}.${key}`);
    }
    for (const [key, check] of Object.entries(optional))
      if (Object.hasOwn(item, key)) check(item[key], `${path}.${key}`);
  };
}
const text: Check = (v, p) => {
  if (typeof v !== "string") fail(p, "expected string");
};
const short: Check = (v, p) => {
  text(v, p);
  if ((v as string).length > 16_384) fail(p, "string exceeds 16384 characters");
};
const id: Check = (v, p) => {
  short(v, p);
  if (!(v as string).trim()) fail(p, "expected nonempty string");
};
const boolean: Check = (v, p) => {
  if (typeof v !== "boolean") fail(p, "expected boolean");
};
const nonnegative: Check = (v, p) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
    fail(p, "expected finite nonnegative number");
};
const integer: Check = (v, p) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    fail(p, "expected safe integer");
};
const date: Check = (v, p) => {
  short(v, p);
  if (!Number.isFinite(Date.parse(v as string)))
    fail(p, "expected date string");
};
const oneOf =
  (...choices: unknown[]): Check =>
  (v, p) => {
    if (!choices.includes(v)) fail(p, `expected ${choices.join(" | ")}`);
  };
function list(check: Check, uniqueKey?: string): Check {
  return (v, p) => {
    if (!Array.isArray(v)) fail(p, "expected array");
    const seen = new Set<unknown>();
    for (const [i, item] of v.entries()) {
      check(item, `${p}[${i}]`);
      if (uniqueKey) {
        const key = record(item, p)[uniqueKey];
        if (seen.has(key)) fail(p, `duplicate ${uniqueKey}: ${String(key)}`);
        seen.add(key);
      }
    }
  };
}
const refs = list(id);
const resource = shape(
  { kind: oneOf("message", "session", "file", "document", "diff", "url"), id },
  { label: short, revision: id },
);
const facts = list(shape({ label: short, value: text }));
const action = shape(
  { id, label: id, command: id },
  {
    // input is already validated by the JSON snapshot, including extension fields.
    disabled: text,
    confirmation: text,
    fields: list(
      shape(
        { name: id, label: short },
        { required: boolean, multiline: boolean },
      ),
      "name",
    ),
  },
);
const actions = list(action, "id");
const state = shape(
  {
    phase: oneOf(
      "queued",
      "running",
      "waiting",
      "paused",
      "finished",
      "unknown",
    ),
  },
  {
    outcome: oneOf("success", "error", "cancelled", "interrupted", "unknown"),
    label: short,
  },
);
const runRequired = { id, title: short, state };
const runOptional = {
  startedAt: date,
  endedAt: date,
  detail: text,
  origin: resource,
  actions,
  facts,
  output: shape(
    { text },
    { truncated: boolean, stream: oneOf("stdout", "stderr", "combined") },
  ),
};
const run = shape(runRequired, runOptional);
const timing: Check = (v, p) => {
  const item = record(v, p);
  switch (item.kind) {
    case "once":
      shape({ kind: oneOf("once"), at: date })(v, p);
      break;
    case "interval":
      shape(
        {
          kind: oneOf("interval"),
          milliseconds: (n, path) => {
            nonnegative(n, path);
            if (n === 0) fail(path, "expected positive interval");
          },
        },
        { anchor: date },
      )(v, p);
      break;
    // Expressions and timezones are opaque source data, not a cron engine contract.
    case "cron":
      shape({ kind: oneOf("cron"), expression: short }, { timezone: short })(
        v,
        p,
      );
      break;
    case "opaque":
      shape({ kind: oneOf("opaque"), description: text })(v, p);
      break;
    default:
      fail(`${p}.kind`, "unknown schedule timing");
  }
};
const target: Check = (v, p) => {
  shape(
    { resource, resolution: oneOf("exact", "outdated", "unresolved") },
    {
      range: (value, path) => {
        const range = record(value, path);
        shape({ kind: oneOf("text", "lines"), start: integer, end: integer })(
          value,
          path,
        );
        if (
          (range.start as number) < (range.kind === "lines" ? 1 : 0) ||
          (range.end as number) <= (range.start as number)
        )
          fail(path, "expected end-exclusive range with start < end");
        if (range.kind === "text")
          shape({ unit: oneOf("unicode-codepoint", "utf16") })(value, path);
        else shape({}, { side: oneOf("before", "after") })(value, path);
      },
      quote: shape({ exact: text }, { prefix: text, suffix: text }),
    },
  )(v, p);
  const item = record(v, p);
  if (
    item.resolution === "exact" &&
    !Object.hasOwn(record(item.resource, p), "revision")
  )
    fail(p, "exact annotation target requires resource revision");
};
const kinds: Record<SessionView["kind"], Check> = {
  todo: shape(
    {
      items: list(
        shape(
          {
            id,
            identity: oneOf("native", "snapshot"),
            title: short,
            state: oneOf(
              "pending",
              "active",
              "completed",
              "cancelled",
              "unknown",
            ),
          },
          {
            stateLabel: short,
            description: text,
            activeLabel: short,
            owner: short,
            dependsOn: refs,
            availability: short,
            actions,
          },
        ),
        "id",
      ),
    },
    { explanation: text },
  ),
  agents: shape(
    {
      runs: list(
        shape(runRequired, {
          ...runOptional,
          agentId: id,
          session: resource,
          parentId: id,
          dependsOn: refs,
          profile: short,
          previousRunId: id,
          task: text,
          model: short,
        }),
        "id",
      ),
    },
    { relations: list(shape({ kind: id, from: id, to: id })) },
  ),
  background: shape({
    runs: list(
      shape(runRequired, {
        ...runOptional,
        command: text,
        cwd: short,
        processId: id,
        exit: shape({}, { code: integer, signal: short }),
        lifetime: oneOf("turn", "session", "host", "external", "unknown"),
      }),
      "id",
    ),
  }),
  schedule: shape({
    schedules: list(
      shape(
        {
          id,
          title: short,
          enabled: oneOf(true, false, null),
          timing,
        },
        {
          nextRunAt: date,
          lifetime: short,
          policy: text,
          runs: list(run, "id"),
          actions,
        },
      ),
      "id",
    ),
  }),
  mode: shape(
    {
      axis: id,
      value: (v, p) => {
        if (v !== null) short(v, p);
      },
      choices: list(shape({ id, label: short }, { action }), "id"),
    },
    { description: text },
  ),
  goal: shape(
    { objective: text, state },
    {
      reason: text,
      measures: list(
        shape(
          { label: short, value: nonnegative, unit: short },
          { limit: nonnegative },
        ),
      ),
    },
  ),
  annotations: shape({
    threads: list(
      shape(
        {
          id,
          target,
          state: oneOf("open", "resolved", "unknown"),
          comments: list(
            shape({ id, body: text }, { author: short, createdAt: date }),
            "id",
          ),
        },
        { actions },
      ),
      "id",
    ),
  }),
  document: shape({
    resource,
    text,
    format: oneOf("text", "markdown"),
    stage: oneOf("draft", "final", "unknown"),
  }),
  status: shape({ text, tone: oneOf("info", "warning", "error") }),
};

/** Validate every consumed field and return a detached, bounded JSON snapshot. */
export function validateView(value: unknown): SessionView {
  const clone = snapshot(value);
  const item = record(clone, "$");
  shape(
    {
      id,
      title: short,
      kind: oneOf(...Object.keys(kinds)),
      source: shape(
        {
          label: short,
          scope: shape({
            kind: oneOf("session", "project", "shared", "global"),
            id,
          }),
          freshness: oneOf("live", "saved", "unknown"),
        },
        { observedAt: date },
      ),
    },
    { origin: resource, actions, facts },
  )(item, "$");
  kinds[item.kind as SessionView["kind"]](item, "$");
  const view = clone as unknown as SessionView;
  const seen = new Set<string>();
  for (const action of viewActions(view)) {
    if (seen.has(action.id))
      fail("$.actions", `duplicate action id: ${action.id}`);
    seen.add(action.id);
  }
  return view;
}

const workState = oneOf(
  "pending",
  "active",
  "completed",
  "cancelled",
  "unknown",
);
const blocks: Record<string, Check> = {
  text: shape({ text }, { format: oneOf("text", "markdown") }),
  code: shape({ text }),
  diff: shape({ text }),
  terminal: shape({ text }),
  facts: shape({ items: facts }),
  list: shape({
    items: list(
      shape({ title: short }, { description: text, state: workState }),
    ),
  }),
};
const block: Check = (v, p) => {
  const kind = record(v, p).type;
  if (typeof kind !== "string" || !Object.hasOwn(blocks, kind))
    fail(`${p}.type`, `expected ${Object.keys(blocks).join(" | ")}`);
  blocks[kind](v, p);
};

/** Same snapshot rules as views: detached, bounded JSON with every consumed field checked. */
export function validateToolCard(value: unknown): ToolCard {
  const clone = snapshot(value);
  shape({ title: id }, { target: short, meta: short, body: list(block) })(
    clone,
    "$",
  );
  return clone as unknown as ToolCard;
}

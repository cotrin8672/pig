import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChatHistory } from "./local-chat-history";
import { SessionManager } from "./sdk";
import { defaultSessionDir } from "./session-directory";

const jsonl = (rows: unknown[]) =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const at = (second: number) =>
  new Date(Date.UTC(2026, 10, 14, 9, 0, second)).toISOString();

async function codexHome(home: string, workspace = "C:/work/piris") {
  const dir = join(home, ".codex", "sessions", "2026", "11", "14");
  await mkdir(dir, { recursive: true });
  const rollout = join(dir, "rollout-2026-11-14T09-00-00-main.jsonl");
  const message = (
    role: string,
    type: string,
    body: string,
    second: number,
  ) => ({
    timestamp: at(second),
    type: "response_item",
    payload: { type: "message", role, content: [{ type, text: body }] },
  });
  await writeFile(
    rollout,
    jsonl([
      {
        timestamp: at(0),
        type: "session_meta",
        payload: { id: "main", cwd: workspace },
      },
      {
        timestamp: at(0),
        type: "event_msg",
        payload: {
          type: "thread_settings_applied",
          thread_settings: { model: "gpt-5.5" },
        },
      },
      message("developer", "input_text", "system rules", 0),
      message(
        "user",
        "input_text",
        "<environment_context>cwd</environment_context>",
        1,
      ),
      message("user", "input_text", "Fix the scrollbar", 2),
      {
        timestamp: at(3),
        type: "response_item",
        payload: { type: "reasoning", summary: [] },
      },
      message("assistant", "output_text", "Looking at the CSS.", 4),
      {
        timestamp: at(5),
        type: "response_item",
        payload: { type: "function_call", name: "shell", arguments: "{}" },
      },
      {
        timestamp: at(6),
        type: "response_item",
        payload: { type: "function_call_output", output: "ok" },
      },
      message("assistant", "output_text", "Fixed.", 7),
    ]).concat('{"torn": '),
  );
  const db = new Database(join(home, ".codex", "state_5.sqlite"));
  db.run(`create table threads (id text, rollout_path text, title text, preview text,
    cwd text, updated_at integer, updated_at_ms integer, source text)`);
  const insert = db.prepare("insert into threads values (?,?,?,?,?,?,?,?)");
  insert.run(
    "main",
    rollout,
    "Fix the scrollbar",
    "",
    workspace,
    0,
    Date.UTC(2026, 10, 14, 9, 1),
    "vscode",
  );
  insert.run(
    "child",
    rollout,
    "Subagent",
    "",
    "C:/work/piris",
    0,
    Date.UTC(2026, 10, 14, 9, 2),
    '{"subagent":{}}',
  );
  insert.run(
    "gone",
    join(dir, "missing.jsonl"),
    "Deleted",
    "",
    "",
    0,
    1,
    "vscode",
  );
  insert.finalize();
  db.close();
}

async function claudeHome(home: string) {
  const dir = join(home, ".claude", "projects", "C--work-piris");
  await mkdir(dir, { recursive: true });
  const user = (
    uuid: string,
    parent: string | null,
    content: unknown,
    extra = {},
  ) => ({
    type: "user",
    uuid,
    parentUuid: parent,
    isSidechain: false,
    cwd: "C:\\work\\piris",
    timestamp: at(Number(uuid.slice(1))),
    message: { role: "user", content },
    ...extra,
  });
  const assistant = (uuid: string, parent: string, content: unknown[]) => ({
    type: "assistant",
    uuid,
    parentUuid: parent,
    isSidechain: false,
    timestamp: at(Number(uuid.slice(1))),
    message: { role: "assistant", model: "claude-opus-5-5", content },
  });
  await writeFile(
    join(dir, "session-a.jsonl"),
    jsonl([
      { type: "queue-operation", operation: "enqueue" },
      user("u1", null, "<command-name>/clear</command-name>", { isMeta: true }),
      user("u2", "u1", "Explain the build"),
      assistant("u3", "u2", [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Old answer" },
      ]),
      assistant("u4", "u2", [
        { type: "text", text: "Running it." },
        { type: "tool_use", name: "Bash", input: {} },
      ]),
      user("u5", "u4", [{ type: "tool_result", content: "ok" }]),
      assistant("u6", "u5", [{ type: "text", text: "It uses Vite." }]),
      {
        ...assistant("u7", "u6", [{ type: "text", text: "sidechain" }]),
        isSidechain: true,
      },
    ]),
  );
  await writeFile(
    join(dir, "empty.jsonl"),
    jsonl([{ type: "queue-operation" }]),
  );
}

test("Codex: indexed threads only, injected context skipped, tool round trips merged", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-local-codex-"));
  try {
    await codexHome(home);
    const history = new LocalChatHistory(home);
    const preview = await history.list("codex");
    expect(preview.conversations.map((item) => item.title)).toEqual([
      "Fix the scrollbar",
    ]);
    expect(preview.conversations[0].workspace).toBe("C:/work/piris");
    expect(JSON.stringify(preview)).not.toContain("rollout-");
    const out = join(home, "out");
    // Each chat is placed by its original workspace.
    const placed: (string | undefined)[] = [];
    const place = async (workspace?: string) => {
      placed.push(workspace);
      return home;
    };
    expect(
      await history.import(
        { previewId: preview.id, cwd: place, ids: ["main"] },
        out,
      ),
    ).toEqual({ copied: 1, skipped: 0, failed: 0 });
    expect(placed).toEqual(["C:/work/piris"]);
    const manager = SessionManager.open(join(out, (await readdir(out))[0]));
    const messages = manager
      .buildSessionContext()
      .messages.filter((m) => m.role === "user" || m.role === "assistant");
    expect(messages.map((m) => m.content)).toEqual([
      "Fix the scrollbar",
      [{ type: "text", text: "Looking at the CSS.\n\nFixed." }],
    ]);
    const answer = messages[1];
    expect(answer.role === "assistant" && answer.model).toBe("gpt-5.5");
    expect(
      await history.import(
        { previewId: preview.id, cwd: home, ids: null },
        out,
      ),
    ).toEqual({ copied: 0, skipped: 1, failed: 0 });
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("Claude Code: active branch only, sidechains and meta skipped, untitled sessions hidden", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-local-claude-"));
  try {
    await claudeHome(home);
    const history = new LocalChatHistory(home);
    const preview = await history.list("claude-code");
    expect(
      preview.conversations.map((item) => [
        item.id,
        item.title,
        item.workspace,
      ]),
    ).toEqual([
      ["C--work-piris/session-a", "Explain the build", "C:\\work\\piris"],
    ]);
    const out = join(home, "out");
    expect(
      await history.import(
        { previewId: preview.id, cwd: home, ids: null },
        out,
      ),
    ).toMatchObject({ copied: 1, failed: 0 });
    const manager = SessionManager.open(join(out, (await readdir(out))[0]));
    const messages = manager
      .buildSessionContext()
      .messages.filter((m) => m.role === "user" || m.role === "assistant");
    expect(messages.map((m) => m.content)).toEqual([
      "Explain the build",
      [{ type: "text", text: "Running it.\n\nIt uses Vite." }],
    ]);
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("thread titles come from Codex names and Claude Code title records", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-local-titles-"));
  try {
    await codexHome(home);
    const db = new Database(join(home, ".codex", "state_5.sqlite"));
    db.run("alter table threads add column name text");
    db.run("update threads set name = 'Scrollbar fix' where id = 'main'");
    db.close();
    await claudeHome(home);
    const dir = join(home, ".claude", "projects", "C--work-piris");
    const user = {
      type: "user",
      uuid: "u1",
      parentUuid: null,
      cwd: "C:\\work\\piris",
      message: { role: "user", content: "First prompt" },
    };
    // Title records land after the head; the last of each kind wins.
    const filler = { type: "attachment", text: "x".repeat(300 * 1024) };
    await writeFile(
      join(dir, "session-b.jsonl"),
      jsonl([
        user,
        filler,
        { type: "ai-title", aiTitle: "Generated title" },
        filler,
        { type: "custom-title", customTitle: "Old name" },
        { type: "custom-title", customTitle: "Renamed" },
      ]),
    );
    await writeFile(
      join(dir, "session-c.jsonl"),
      jsonl([user, { type: "ai-title", aiTitle: "Generated title" }]),
    );
    const history = new LocalChatHistory(home);
    expect(
      (await history.list("codex")).conversations.map((item) => item.title),
    ).toEqual(["Scrollbar fix"]);
    const claude = await history.list("claude-code");
    expect(
      Object.fromEntries(
        claude.conversations.map((item) => [item.id, item.title]),
      ),
    ).toEqual({
      "C--work-piris/session-a": "Explain the build",
      "C--work-piris/session-b": "Renamed",
      "C--work-piris/session-c": "Generated title",
    });
    const out = join(home, "out");
    await history.import(
      {
        previewId: claude.id,
        cwd: home,
        ids: ["C--work-piris/session-b"],
      },
      out,
    );
    const manager = SessionManager.open(join(out, (await readdir(out))[0]));
    expect(manager.getSessionName()).toBe("Renamed");
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("Codex Windows namespace prefixes never reach SDK session directory names", async () => {
  for (const [source, expected] of [
    ["\\\\?\\C:\\work\\piris", "C:\\work\\piris"],
    ["\\\\?\\UNC\\server\\share\\piris", "\\\\server\\share\\piris"],
  ]) {
    const home = await mkdtemp(join(tmpdir(), "pig-local-path-"));
    try {
      await codexHome(home, source);
      const history = new LocalChatHistory(home);
      const preview = await history.list("codex");
      const workspace = preview.conversations[0].workspace as string;
      expect(workspace).toBe(expected);
      const directory = defaultSessionDir(workspace, join(home, "agent"));
      expect(directory).not.toContain("?");
      expect(
        await history.import(
          {
            previewId: preview.id,
            cwd: async (cwd) => cwd as string,
            ids: null,
          },
          directory,
        ),
      ).toEqual({ copied: 1, skipped: 0, failed: 0 });
      const manager = SessionManager.open(
        join(directory, (await readdir(directory))[0]),
      );
      expect(manager.getHeader()?.cwd).toBe(expected);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("local import failures retain the conversation and concrete cause for retry", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-local-failure-"));
  try {
    await codexHome(home);
    const history = new LocalChatHistory(home);
    const preview = await history.list("codex");
    const directory = join(home, "out");
    expect(
      await history.import(
        {
          previewId: preview.id,
          ids: null,
          cwd: async () => {
            throw new Error("The destination project could not be saved.");
          },
        },
        directory,
      ),
    ).toEqual({
      copied: 0,
      skipped: 0,
      failed: 1,
      errors: [
        {
          id: "main",
          title: "Fix the scrollbar",
          message: "The destination project could not be saved.",
        },
      ],
    });
    await writeFile(directory, "not a directory");
    const result = await history.import(
      { previewId: preview.id, ids: null, cwd: home },
      join(directory, "sessions"),
    );
    expect(result.failed).toBe(1);
    expect(result.errors?.[0].message).toContain("mkdir");
    expect(result.errors?.[0].message).toContain(directory);
    expect(
      await history.import(
        { previewId: preview.id, ids: null, cwd: home },
        join(home, "retry"),
      ),
    ).toEqual({ copied: 1, skipped: 0, failed: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("missing histories and stale or foreign selections are rejected", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-local-none-"));
  try {
    const history = new LocalChatHistory(home);
    await expect(history.list("codex")).rejects.toThrow("No Codex history");
    await expect(history.list("claude-code")).rejects.toThrow(
      "No Claude Code history",
    );
    await claudeHome(home);
    const preview = await history.list("claude-code");
    await expect(
      history.import({ previewId: "other", cwd: home, ids: null }),
    ).rejects.toThrow("again");
    await expect(
      history.import({ previewId: preview.id, cwd: home, ids: ["invented"] }),
    ).rejects.toThrow("Choose");
    history.clear();
    expect(history.owns(preview.id)).toBe(false);
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

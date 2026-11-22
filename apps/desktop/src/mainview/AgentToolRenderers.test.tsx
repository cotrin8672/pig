import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../shared/i18n";
import {
  hydrate,
  type Message,
  type TranscriptRecord,
} from "../shared/transcript";
import { customPresentation } from "./custom-data";
import { scheduledUsers } from "./scheduled-prompt-model";

mock.module("./rpc", () => ({
  rpc: { send: {} },
  openChatLink: async () => {},
  regenerate: async () => {},
}));
const {
  AskUserRenderer,
  SubagentRenderer,
  SchedulePromptRenderer,
  cadence,
  parseJobs,
} = await import("./AgentToolRenderers");
const none = () => null;
const done = (text: string, details?: unknown) => ({
  status: "done" as const,
  result: { content: [{ type: "text", text }], details },
});
const t = en.agentTools;

test("ask_user keeps every option and marks the chosen one with the reply", () => {
  const html = renderToStaticMarkup(
    <AskUserRenderer
      DefaultRenderer={none}
      data={{
        call: {
          id: "a",
          name: "ask_user",
          arguments: {
            question: "Where?",
            options: [{ title: "Chips" }, { title: "Rail" }],
          },
        },
        live: false,
        state: done("User answered: Chips", {
          response: {
            kind: "selection",
            selections: ["Chips"],
            comment: "as before",
          },
          cancelled: false,
        }),
      }}
    />,
  );
  for (const text of ["Where?", "Chips", "Rail", "as before", t.question])
    expect(html).toContain(text);
  // A regular tool row like subagent and schedule_prompt, the answer in its summary.
  expect(html).toContain('class="tool-row done"');
  expect(html).toContain('<span class="tool-meta">Chips');
  expect(html.match(/data-picked="true"/g)?.length).toBe(1);
});

test("subagent draws one lane per child with failures counted", () => {
  const html = renderToStaticMarkup(
    <SubagentRenderer
      DefaultRenderer={none}
      data={{
        call: { id: "s", name: "subagent", arguments: { tasks: [] } },
        live: false,
        state: done("", {
          results: [
            { agent: "scout", task: "find", exitCode: 0, finalOutput: "ok" },
            { agent: "tester", task: "test", exitCode: 1 },
          ],
        }),
      }}
    />,
  );
  for (const text of ["@scout", "@tester", t.succeeded(1, 2)])
    expect(html).toContain(text);
});

test("schedule_prompt reads cron as words and parses the list", () => {
  expect(cadence("cron", "0 0 9 * * *", t)).toBe("Daily 9:00");
  expect(cadence("interval", "15m", t)).toBe("Every 15m");
  expect(cadence("cron", "*/5 * * * * *", t)).toBe("*/5 * * * * *");
  const jobs = parseJobs(
    "✓ a (x1)\n  Type: cron | Schedule: 0 0 9 * * *\n  Prompt: hi\n  Never run | Next: tomorrow\n  Runs: 0 | Status: pending\n✗ b (x2)\n  Type: interval | Schedule: 5m\n  Prompt: yo\n  Last: now \n  Runs: 2 | Status: error",
  );
  expect(jobs.map((job) => [job.name, job.enabled, job.status])).toEqual([
    ["a", true, "pending"],
    ["b", false, "error"],
  ]);
  const html = renderToStaticMarkup(
    <SchedulePromptRenderer
      DefaultRenderer={none}
      data={{
        call: {
          id: "p",
          name: "schedule_prompt",
          arguments: {
            action: "add",
            name: "ci",
            schedule: "0 0 9 * * *",
            prompt: "check",
          },
        },
        live: false,
        state: done("✓ Created"),
      }}
    />,
  );
  for (const text of [t.actions.add, "ci", "Daily 9:00"])
    expect(html).toContain(text);
});

test("a fire marker folds into the user bubble carrying its prompt", () => {
  const base = { branchId: "main", parentId: null, order: 0 };
  const marker = {
    ...base,
    id: "m",
    kind: "message",
    message: {
      role: "custom",
      customType: "scheduled_prompt",
      content: [],
      display: true,
      details: { jobId: "j", jobName: "morning", prompt: "check CI" },
      timestamp: 0,
    },
  } as unknown as TranscriptRecord;
  const reply = {
    ...base,
    id: "r",
    kind: "message",
    message: { role: "assistant", content: [], timestamp: 0 },
  } as unknown as TranscriptRecord;
  const user = {
    ...base,
    id: "u",
    kind: "message",
    message: { role: "user", content: "check CI", timestamp: 0 },
  } as unknown as TranscriptRecord;
  expect(customPresentation(marker).hidden).toBe(true);
  expect([...scheduledUsers([marker, reply, user])]).toEqual([
    ["u", "morning"],
  ]);
});

test("fire markers claim only later prompts, once each and in marker order", () => {
  const marker = (jobName: string, prompt: string, mode?: string): Message => ({
    role: "custom",
    customType: "scheduled_prompt",
    content: [],
    display: true,
    details: { jobName, prompt, mode },
    timestamp: 0,
  });
  const user = (
    content: Extract<Message, { role: "user" }>["content"],
  ): Message => ({
    role: "user",
    content,
    timestamp: 0,
  });
  const { records } = hydrate([
    user("repeat"),
    marker("first", " repeat "),
    marker("second", "other"),
    marker("separate session", "repeat", "subagent_start"),
    marker("third", "repeat"),
    user("other"),
    user([{ type: "text", text: "repeat\n" }]),
    user("repeat"),
    marker("too late", "other"),
    user("repeat"),
  ]);
  expect([...scheduledUsers(records)]).toEqual([
    [records[6].id, "first"],
    [records[5].id, "second"],
    [records[7].id, "third"],
  ]);
  expect(scheduledUsers([records[0]])).toEqual(new Map());
});

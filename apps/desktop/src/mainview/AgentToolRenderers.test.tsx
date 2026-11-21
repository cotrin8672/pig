import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../shared/i18n";

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
  for (const text of ["Where?", "Chips", "Rail", "as before", t.answered])
    expect(html).toContain(text);
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

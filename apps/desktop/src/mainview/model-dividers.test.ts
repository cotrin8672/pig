import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Message, TranscriptRecord } from "../shared/transcript";
import { modelDividers } from "./model-dividers";

function turn(id: string, message: Message): TranscriptRecord {
  return {
    id,
    parentId: null,
    branchId: "root",
    order: 0,
    kind: "message",
    message,
  };
}
const user = (id: string) =>
  turn(id, { role: "user", content: id, timestamp: 0 });
const assistant = (id: string, model: string, provider = "p") =>
  turn(id, { ...fauxAssistantMessage(id), provider, model });
const selection = (id: string, modelId: string): TranscriptRecord => ({
  id,
  parentId: null,
  branchId: "root",
  order: 0,
  kind: "session-entry",
  entryType: "model_change",
  data: { provider: "p", modelId },
});

// Independent pre-optimization scan; compare values and divider positions, not
// internal object sharing between immutable model labels.
function originalDividers(records: TranscriptRecord[]) {
  type Model = { provider: string; id: string };
  const changes = new Map<string, { from: Model; to: Model }>();
  let previous: Model | undefined;
  let userId: string | undefined;
  let answered = false;
  for (const record of records) {
    if (record.kind !== "message") continue;
    const { message } = record;
    if (message.role === "user") {
      userId = record.id;
      answered = false;
    } else if (message.role === "assistant") {
      const model = { provider: message.provider, id: message.model };
      if (
        !answered &&
        previous &&
        (previous.provider !== model.provider || previous.id !== model.id)
      )
        changes.set(userId ?? record.id, { from: previous, to: model });
      previous = model;
      answered = true;
    }
  }
  return changes;
}

test("model dividers match the original scan across append, prepend, edits, reorder, branch and saved-ID changes", () => {
  let seed = 8672;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let sample = 0; sample < 100; sample++) {
    const records = Array.from({ length: 80 }, (_, i) => {
      const id = `${sample}-${i}`;
      const kind = random() % 10;
      return kind < 2
        ? user(id)
        : kind < 9
          ? assistant(id, `model-${random() % 3}`, `provider-${random() % 2}`)
          : selection(id, "intent-only");
    });
    const variants = [
      records,
      records.slice(20),
      [...records, user("live-user"), assistant("live", "new")],
      [user("earlier-user"), assistant("earlier-answer", "old"), ...records],
      [...records].reverse(),
      [...records.slice(20), ...records.slice(0, 20)],
      records.map((record, i) => ({
        ...record,
        id: `saved-${i}`,
        entryId: `saved-${i}`,
        branchId: "replacement",
        order: i,
      })),
      records.map((record, i) =>
        i === 12 ? assistant(record.id, "edited", "other") : record,
      ),
    ];
    for (const incoming of variants)
      expect([...modelDividers(incoming)]).toEqual([
        ...originalDividers(incoming),
      ]);
  }
});

test("picker changes stay hidden until a response uses the final model at a turn boundary", () => {
  const records = [
    selection("initial", "A"),
    user("u1"),
    assistant("a1", "A"),
    selection("pick-b", "B"),
    selection("pick-c", "C"),
  ];
  expect(modelDividers(records).size).toBe(0);
  records.push(user("u2"));
  expect(modelDividers(records).size).toBe(0);
  records.push(assistant("a2", "C"), assistant("a3", "C"));
  expect([...modelDividers(records)]).toEqual([
    [
      "u2",
      { from: { provider: "p", id: "A" }, to: { provider: "p", id: "C" } },
    ],
  ]);
});

test("switching away and back, or selecting a model before the first response, adds no divider", () => {
  expect(
    modelDividers([
      selection("initial", "A"),
      selection("pick-b", "B"),
      user("u1"),
      assistant("a1", "B"),
      selection("pick-c", "C"),
      selection("pick-b-again", "B"),
      user("u2"),
      assistant("a2", "B"),
    ]).size,
  ).toBe(0);
});

test("actual response providers matter even without model-change metadata", () => {
  expect([
    ...modelDividers([
      user("u1"),
      assistant("a1", "same", "anthropic"),
      user("u2"),
      assistant("a2", "same", "openai-codex"),
    ]),
  ]).toEqual([
    [
      "u2",
      {
        from: { provider: "anthropic", id: "same" },
        to: { provider: "openai-codex", id: "same" },
      },
    ],
  ]);
});

test("tool-loop model changes never insert a mid-turn divider", () => {
  const records = [
    user("u1"),
    assistant("a1", "A"),
    selection("fallback", "B"),
    assistant("a2", "B"),
    user("u2"),
    assistant("a3", "B"),
  ];
  expect(modelDividers(records).size).toBe(0);
  records.push(user("u3"), assistant("a4", "C"));
  expect([...modelDividers(records)]).toEqual([
    [
      "u3",
      { from: { provider: "p", id: "B" }, to: { provider: "p", id: "C" } },
    ],
  ]);
});

test("a history page starting inside a response does not invent a model change", () => {
  expect(
    modelDividers([assistant("partial-a", "A"), assistant("partial-b", "B")])
      .size,
  ).toBe(0);
  expect([
    ...modelDividers([
      assistant("partial", "B"),
      user("u2"),
      assistant("a2", "C"),
    ]).keys(),
  ]).toEqual(["u2"]);
});

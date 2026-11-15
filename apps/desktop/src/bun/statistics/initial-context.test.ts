import { expect, test } from "bun:test";
import { fixture } from "./fixtures";
import { initialContextMetadata } from "./initial-context";

test("initial context counts normalized system sections and visible declarations, without retaining content", () => {
  const messages: Parameters<typeof initialContextMetadata>[0] = [
    {
      role: "system",
      content: "",
      timestamp: 1,
      sections: {
        preamble: "SECRET system",
        project_context: "SECRET agents",
        skills: "SECRET skills",
      },
      toolsAdded: [
        {
          name: "read",
          description: "SECRET tool",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
    {
      role: "system",
      content: "",
      timestamp: 2,
      sections: { plugin: "SECRET extension" },
      toolsAdded: [
        {
          name: "hidden",
          description: "SECRET hidden",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
    {
      role: "system",
      content: "",
      timestamp: 3,
      toolsRemoved: [{ name: "hidden" }],
    },
    { role: "user", content: "SECRET USER does not contribute", timestamp: 4 },
  ];
  const metadata = initialContextMetadata(messages, 200000);
  expect(metadata?.parts.map((p) => p.id)).toEqual([
    "base",
    "tools",
    "agents",
    "skills",
    "extensions",
  ]);
  expect(metadata?.tools.map((t) => t.name)).toEqual(["read"]);
  expect(JSON.stringify(metadata)).not.toContain("SECRET");
  const { collector, events } = fixture();
  collector.initialContext(messages, 200000);
  collector.initialContext(messages, 200000);
  expect(events.filter((e) => e.type === "initial_context")).toHaveLength(1);
});
